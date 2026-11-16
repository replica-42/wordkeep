"""Build-resource checks using temporary fixtures."""

import hashlib
import importlib.metadata
import importlib.util
import json
import zipfile
from pathlib import Path, PurePosixPath
from types import SimpleNamespace

import pytest

from wordkeep_backend.core.hanlp_backend import REQUIRED_RESOURCES


@pytest.fixture
def builder(tmp_path, monkeypatch, project_root):
    spec = importlib.util.spec_from_file_location(
        "wordkeep_release_build", project_root / "packaging/build.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "BUILD", tmp_path / "build")
    monkeypatch.setattr(module, "DIST", tmp_path / "dist")
    monkeypatch.setattr(module, "RESOURCES", tmp_path / "dist/wordkeep-backend")
    module.BUILD.mkdir()
    (tmp_path / "LICENSE").write_text("MIT", encoding="utf-8")
    (tmp_path / "data").mkdir()
    module.RESOURCES.mkdir(parents=True)
    return module


def checksum(data):
    return hashlib.sha256(data).hexdigest()


def test_model_manifest_covers_required_resources_and_excludes_unused_files(
    project_root,
):
    manifest = json.loads((project_root / "data/model-manifest.json").read_text())
    files = {name for entry in manifest for name in entry["files"]}
    assert files == set(REQUIRED_RESOURCES)
    assert all(not name.endswith((".zip", ".log")) for name in files)


def test_build_extracts_only_pinned_files_and_verifies_contents(builder):
    downloads = builder.BUILD / "downloads"
    downloads.mkdir()
    archive = downloads / "model.zip"
    data = b"uncompressed runtime weights"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as compressed:
        compressed.writestr("model/weights.pt", data)
        compressed.writestr("model/train.log", "unused")
        compressed.writestr("../../escape.txt", "must not extract")
    manifest = [
        {
            "resource": "mtl/model.zip",
            "url": "https://invalid.example/model.zip",
            "sha256": builder.digest(archive),
            "files": {"mtl/model/weights.pt": checksum(data)},
        }
    ]
    (builder.ROOT / "data/model-manifest.json").write_text(json.dumps(manifest))
    builder.prepare_models()
    model = builder.RESOURCES / "data/hanlp/mtl/model/weights.pt"
    assert model.read_bytes() == data
    assert sorted(p.name for p in model.parent.iterdir()) == ["weights.pt"]
    assert not (builder.ROOT / "escape.txt").exists()


def test_invalid_extracted_model_aborts_build(builder):
    downloads = builder.BUILD / "downloads"
    downloads.mkdir()
    archive = downloads / "model.zip"
    with zipfile.ZipFile(archive, "w") as compressed:
        compressed.writestr("model.pt", b"wrong content")
    manifest = [
        {
            "resource": "mtl/model.zip",
            "url": "https://invalid.example/model.zip",
            "sha256": builder.digest(archive),
            "files": {"mtl/model.pt": checksum(b"expected content")},
        }
    ]
    (builder.ROOT / "data/model-manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="model file checksum failed"):
        builder.prepare_models()


def test_resource_cannot_escape_staging_directory(builder):
    with pytest.raises(ValueError, match="escapes"):
        builder.checked_path(builder.RESOURCES, "../outside")


def test_wordcloud_copyright_and_full_license_are_collected(builder, monkeypatch):
    dist = importlib.metadata.distribution("wordcloud")
    (builder.ROOT / "packaging/licenses").mkdir(parents=True)
    (builder.ROOT / "packaging/THIRD_PARTY_NOTICES.md").write_text("Notices")
    monkeypatch.setattr(builder, "bundled_distributions", lambda: [dist])
    monkeypatch.setattr(builder.sys, "base_prefix", str(builder.ROOT / "python"))
    monkeypatch.setattr(
        builder.sysconfig, "get_path", lambda name: str(builder.ROOT / "python/lib")
    )

    builder.collect_licenses()

    target = builder.RESOURCES / "licenses"
    packages = json.loads((target / "packages.json").read_text())
    assert len(packages) == 1
    package = packages[0]
    assert package["name"] == "wordcloud"
    assert package["version"] == dist.version
    assert package["license"] == "MIT"
    source = next(file for file in dist.files if file.name == "LICENSE")
    copied = target / package["license_files"][0]
    assert copied.read_bytes() == Path(dist.locate_file(source)).read_bytes()
    assert "Copyright (c) 2012 Andreas Christian Mueller" in copied.read_text()


@pytest.mark.parametrize("succeed", [False, True])
def test_release_replaces_previous_resources_only_after_success(
    builder, monkeypatch, succeed
):
    previous = builder.RESOURCES / "previous.txt"
    previous.write_text("working release")
    monkeypatch.setattr(builder.sys, "platform", "darwin")
    monkeypatch.setattr(builder.platform, "machine", lambda: "arm64")

    def build_resources(architecture):
        assert architecture == "arm64"
        (builder.RESOURCES / "new.txt").write_text("new release")
        (builder.RESOURCES / "build-manifest.json").write_text("{}")
        if not succeed:
            raise RuntimeError("interrupted backend build")

    monkeypatch.setattr(builder, "build_resources", build_resources)
    if succeed:
        builder.publish("arm64", "signature")
        assert not previous.exists()
        assert (builder.RESOURCES / "new.txt").read_text() == "new release"
    else:
        with pytest.raises(RuntimeError, match="interrupted"):
            builder.publish("arm64", "signature")
        assert previous.read_text() == "working release"
        assert not (builder.RESOURCES / "new.txt").exists()
    assert builder.RESOURCES == builder.DIST / "wordkeep-backend"


def test_release_recovers_previous_directory_after_interrupted_publish(
    builder, monkeypatch
):
    (builder.RESOURCES / "previous.txt").write_text("working release")
    builder.RESOURCES.rename(builder.DIST / "wordkeep-backend.previous")
    monkeypatch.setattr(builder.sys, "platform", "darwin")
    monkeypatch.setattr(builder.platform, "machine", lambda: "arm64")

    def fail(architecture):
        raise RuntimeError("failed")

    monkeypatch.setattr(builder, "build_resources", fail)
    with pytest.raises(RuntimeError, match="failed"):
        builder.publish("arm64", "signature")
    assert (builder.RESOURCES / "previous.txt").read_text() == "working release"


def test_license_selection_uses_frozen_files_not_development_environment(
    builder, monkeypatch
):
    bundle = builder.RESOURCES / "_internal"
    for name in [
        "runtime/__init__.pyc",
        "native/library.dll",
        "metadata_only.dist-info/METADATA",
    ]:
        path = bundle / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"bundled")

    def dist(name, files):
        return SimpleNamespace(
            metadata={"Name": name}, files=[PurePosixPath(p) for p in files]
        )

    distributions = [
        dist("runtime", ["runtime/__init__.py"]),
        dist("native", ["native/library.dll"]),
        dist("metadata-only", ["metadata_only.dist-info/METADATA"]),
        dist("pytest", ["pytest/__init__.py"]),
        dist("ruff", ["../../bin/ruff"]),
        dist("PyInstaller", []),
    ]
    monkeypatch.setattr(
        builder.importlib.metadata, "distributions", lambda: distributions
    )
    selected = {dist.metadata["Name"] for dist in builder.bundled_distributions()}
    assert selected == {"runtime", "native", "metadata-only", "PyInstaller"}


def test_license_selection_requires_a_frozen_backend(builder):
    with pytest.raises(RuntimeError, match="Build the backend"):
        builder.bundled_distributions()


def fake_release(builder, signature="unchanged"):
    (builder.RESOURCES / "wordkeep-backend").write_bytes(b"executable")
    (builder.RESOURCES / "build-manifest.json").write_text(
        json.dumps(
            {
                "fingerprint": signature,
                "files": {"wordkeep-backend": 10},
            }
        ),
        encoding="utf-8",
    )


def test_existing_release_skips_environment_sync_and_packaging(builder, monkeypatch):
    fake_release(builder)
    monkeypatch.setattr(builder, "fingerprint", lambda: "unchanged")
    monkeypatch.setattr(builder, "architecture", lambda: "arm64")

    def unexpected():
        pytest.fail("A complete matching release should be reused")

    monkeypatch.setattr(builder, "build_environment", unexpected)
    builder.main(["build"])
    assert (builder.RESOURCES / "wordkeep-backend").read_bytes() == b"executable"


@pytest.mark.parametrize("change", ["source", "missing", "truncated"])
def test_stale_or_incomplete_release_requires_build(builder, change):
    fake_release(builder)
    if change == "missing":
        (builder.RESOURCES / "wordkeep-backend").unlink()
    elif change == "truncated":
        (builder.RESOURCES / "wordkeep-backend").write_bytes(b"bad")
    signature = "new source" if change == "source" else "unchanged"
    assert not builder.reusable(signature)


def test_force_uses_isolated_worker_even_with_valid_output(builder, monkeypatch):
    fake_release(builder)
    monkeypatch.setattr(builder, "fingerprint", lambda: "unchanged")
    monkeypatch.setattr(builder, "architecture", lambda: "arm64")
    python = builder.BUILD / "venv/bin/python"
    monkeypatch.setattr(builder, "build_environment", lambda: python)
    calls = []
    monkeypatch.setattr(
        builder.subprocess, "run", lambda command, **kw: calls.append((command, kw))
    )
    monkeypatch.setenv("PYTHONPATH", "/unrelated/source")
    builder.main(["build", "--force"])
    command, options = calls[0]
    assert command[0] == str(python)
    assert command[-3:] == ["build", "--worker", "--force"]
    assert "PYTHONPATH" not in options["env"]


def test_isolated_environment_installs_only_runtime_and_packaging(builder, monkeypatch):
    (builder.ROOT / ".python-version").write_text("3.14.10\n", encoding="utf-8")
    monkeypatch.setenv("VIRTUAL_ENV", str(builder.ROOT / ".venv"))
    monkeypatch.setattr(builder.shutil, "which", lambda command: "/tools/uv")
    calls = []
    monkeypatch.setattr(
        builder.subprocess, "run", lambda command, **kw: calls.append((command, kw))
    )
    python = builder.build_environment()
    command, options = calls[0]
    assert "--locked" in command and "--managed-python" in command
    assert "--no-default-groups" in command and "--no-editable" in command
    assert command[command.index("--group") + 1] == "packaging"
    assert command[command.index("--python") + 1] == "3.14.10"
    assert options["env"]["UV_PROJECT_ENVIRONMENT"] == str(builder.BUILD / "venv")
    assert "VIRTUAL_ENV" not in options["env"]
    assert python.is_relative_to(builder.BUILD / "venv")


@pytest.mark.parametrize("all_outputs", [False, True])
def test_clean_preserves_development_environment_and_source_models(
    builder, all_outputs
):
    keep = [".venv/marker", "data/hanlp/model.pt", "src/wordkeep_backend/module.py"]
    caches = [
        "build/pyinstaller/cache",
        "build/frozen/cache",
        "build/downloads/model.zip",
        "build/uv-cache/cache",
        ".pytest_cache/cache",
        "src/wordkeep_backend/__pycache__/module.pyc",
        "dist/wordkeep-backend.partial/unfinished",
    ]
    outputs = [
        "build/venv/marker",
        "dist/wordkeep-backend/executable",
        "dist/package.whl",
    ]
    for name in keep + caches + outputs:
        path = builder.ROOT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("keep", encoding="utf-8")
    builder.main(["clean", "--all"] if all_outputs else ["clean"])
    assert all((builder.ROOT / name).is_file() for name in keep)
    assert all(not (builder.ROOT / name).exists() for name in caches)
    assert all((builder.ROOT / name).exists() != all_outputs for name in outputs)


def test_fingerprint_tracks_build_inputs_but_not_generated_bytecode(
    builder, monkeypatch
):
    monkeypatch.delenv("WORDKEEP_CODESIGN_IDENTITY", raising=False)
    for name in (
        "pyproject.toml",
        "uv.lock",
        ".python-version",
        "config.json",
        "data/model-manifest.json",
        "data/download_models.py",
    ):
        (builder.ROOT / name).write_text("input", encoding="utf-8")
    src = builder.ROOT / "src/wordkeep_backend"
    src.mkdir(parents=True)
    (src / "__init__.py").write_text("version = 1", encoding="utf-8")
    original = builder.fingerprint()
    monkeypatch.setenv("WORDKEEP_CODESIGN_IDENTITY", "A" * 40)
    signed = builder.fingerprint()
    assert signed != original
    monkeypatch.setenv("WORDKEEP_CODESIGN_IDENTITY", "B" * 40)
    assert builder.fingerprint() not in (original, signed)
    monkeypatch.delenv("WORDKEEP_CODESIGN_IDENTITY")
    assert builder.fingerprint() == original
    (src / "__pycache__").mkdir()
    (src / "__pycache__/bytecode.pyc").write_bytes(b"generated")
    assert builder.fingerprint() == original
    (src / "__init__.py").write_text("version = 2", encoding="utf-8")
    assert builder.fingerprint() != original
