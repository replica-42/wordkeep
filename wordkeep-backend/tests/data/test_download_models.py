"""Model download, integrity and standalone command behavior."""

import hashlib
import json
import runpy
import shutil
import subprocess
import sys
import zipfile
from types import SimpleNamespace

import pytest


@pytest.fixture
def model_download(tmp_path, project_root):
    script = project_root / "data/download_models.py"
    downloader = SimpleNamespace(**runpy.run_path(str(script)))
    archive = tmp_path / "upstream.zip"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("model/weights.pt", b"weights")
        output.writestr("model/config.json", b"{}")
        output.writestr("../../outside", b"unused")
    files = {"mtl/model/weights.pt": b"weights", "mtl/model/config.json": b"{}"}
    manifest = [
        {
            "resource": "mtl/model.zip",
            "url": archive.as_uri(),
            "sha256": downloader.digest(archive),
            "files": {
                name: hashlib.sha256(data).hexdigest() for name, data in files.items()
            },
        }
    ]
    path = tmp_path / "model-manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return SimpleNamespace(
        module=downloader,
        manifest=manifest,
        path=path,
        destination=tmp_path / "hanlp",
        cache=tmp_path / "build/downloads",
        archive=archive,
        script=script,
    )


def prepare(case):
    case.module.prepare_models(case.path, case.destination, case.cache)


def deny_network(*args, **kwargs):
    pytest.fail("Valid models or archive should be reused without downloading")


def test_missing_models_download_and_repeated_execution_reuses_them(
    model_download, monkeypatch
):
    case = model_download
    prepare(case)
    files = {
        p.relative_to(case.destination).as_posix(): p.stat().st_mtime_ns
        for p in case.destination.rglob("*")
        if p.is_file()
    }
    assert set(files) == set(case.manifest[0]["files"])
    assert not (case.path.parent / "outside").exists()
    monkeypatch.setattr(case.module.urllib.request, "urlopen", deny_network)
    prepare(case)
    assert files == {
        p.relative_to(case.destination).as_posix(): p.stat().st_mtime_ns
        for p in case.destination.rglob("*")
        if p.is_file()
    }


def test_corrupt_model_is_repaired_from_verified_download_cache(
    model_download, monkeypatch
):
    case = model_download
    prepare(case)
    model = case.destination / "mtl/model/weights.pt"
    model.write_bytes(b"corrupt")
    monkeypatch.setattr(case.module.urllib.request, "urlopen", deny_network)
    prepare(case)
    assert model.read_bytes() == b"weights"


def test_corrupt_archive_is_downloaded_again(model_download):
    case = model_download
    case.cache.mkdir(parents=True)
    (case.cache / "model.zip").write_bytes(b"corrupt")
    prepare(case)
    assert case.module.digest(case.cache / "model.zip") == case.manifest[0]["sha256"]


def test_failed_download_checksum_leaves_no_model_or_partial_file(model_download):
    case = model_download
    case.manifest[0]["sha256"] = "0" * 64
    case.path.write_text(json.dumps(case.manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="download checksum failed"):
        prepare(case)
    assert not case.destination.exists()
    assert list(case.cache.iterdir()) == []


def test_failed_extraction_keeps_existing_files(model_download):
    case = model_download
    model = case.destination / "mtl/model/weights.pt"
    model.parent.mkdir(parents=True)
    model.write_bytes(b"existing")
    case.manifest[0]["files"]["mtl/model/config.json"] = "0" * 64
    case.path.write_text(json.dumps(case.manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="model file checksum failed"):
        prepare(case)
    assert model.read_bytes() == b"existing"
    assert not (model.parent / "config.json").exists()
    assert not list(case.cache.glob("extract-*"))


def test_cli_resolves_destination_beside_manifest_from_other_cwd(
    model_download, tmp_path
):
    case = model_download
    data = tmp_path / "project/data"
    data.mkdir(parents=True)
    shutil.copyfile(case.script, data / "download_models.py")
    shutil.copyfile(case.path, data / "model-manifest.json")
    subprocess.run(
        [sys.executable, str(data / "download_models.py")], cwd=tmp_path, check=True
    )
    assert (data / "hanlp/mtl/model/weights.pt").read_bytes() == b"weights"
    assert (data.parent / "build/downloads/model.zip").is_file()
    assert not (tmp_path / "hanlp").exists()


def test_verified_local_source_is_used_for_build_without_download(
    model_download, monkeypatch
):
    case = model_download
    source = case.path.parent / "local-models"
    for name, content in {
        "mtl/model/weights.pt": b"weights",
        "mtl/model/config.json": b"{}",
    }.items():
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    monkeypatch.setattr(case.module.urllib.request, "urlopen", deny_network)
    case.module.prepare_models(case.path, case.destination, case.cache, source=source)
    assert (case.destination / "mtl/model/weights.pt").read_bytes() == b"weights"
    assert not case.cache.exists()
