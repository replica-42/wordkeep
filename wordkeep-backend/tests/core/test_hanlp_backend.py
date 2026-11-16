"""Local model integration with a relocated, read-only application resource bundle."""

import json
import os
import shutil
import subprocess
import sys
from types import SimpleNamespace

import pytest

from wordkeep_backend import AnalysisConfig, load_config
from wordkeep_backend.core.hanlp_backend import (
    MODEL_DIRECTORY,
    REQUIRED_RESOURCES,
    HanLPAnnotator,
)


def model_config(tmp_path):
    return AnalysisConfig(
        tmp_path / "hanlp",
        tmp_path / "stopwords.txt",
        tmp_path / "dict.txt",
    )


def test_missing_model_fails_without_changing_environment(tmp_path, monkeypatch):
    config = model_config(tmp_path)
    monkeypatch.setenv("HANLP_HOME", "unchanged")
    with pytest.raises(FileNotFoundError, match="model.pt"):
        HanLPAnnotator(config)
    assert os.environ["HANLP_HOME"] == "unchanged"


def test_an_imported_hanlp_cannot_silently_switch_resource_roots(tmp_path, monkeypatch):
    config = model_config(tmp_path)
    for name in REQUIRED_RESOURCES:
        path = config.hanlp_home / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()

    def get_resource(path, save_dir=str(tmp_path / "previous")):
        raise AssertionError("resource lookup must not run")

    monkeypatch.setitem(
        sys.modules, "hanlp.utils.io_util", SimpleNamespace(get_resource=get_resource)
    )
    monkeypatch.setenv("HANLP_HOME", "unchanged")
    with pytest.raises(RuntimeError, match="new Python worker"):
        HanLPAnnotator(config)
    assert os.environ["HANLP_HOME"] == "unchanged"


@pytest.mark.integration
def test_relocated_readonly_resources_use_installed_package_offline(
    tmp_path, app_config_path
):
    source_config = load_config(app_config_path)
    if not (source_config.hanlp_home / MODEL_DIRECTORY / "model.pt").is_file():
        pytest.skip("application model resources are not installed")
    bundle = tmp_path / "应用 Resources"
    bundle.mkdir()
    shutil.copy2(app_config_path, bundle / "config.json")
    shutil.copytree(app_config_path.parent / "data", bundle / "data")
    shutil.copytree(source_config.hanlp_home, bundle / "data/hanlp")
    payload = json.loads((bundle / "config.json").read_text())
    payload["analysis"]["hanlp_home"] = "data/hanlp"
    (bundle / "config.json").write_text(json.dumps(payload), encoding="utf-8")
    config = load_config(bundle / "config.json")
    config.dictionary_path.write_text(
        "再见菈菈\n伶\n不喜欢\n不舒服\n猫\n累\n爱\n", encoding="utf-8"
    )
    config.stopwords_path.write_text("网页链接\n真的\n看完\n", encoding="utf-8")
    entries = list(bundle.rglob("*")) + [bundle]
    for path in entries:
        path.chmod(0o555 if path.is_dir() else 0o444)
    before = {
        str(p.relative_to(bundle)): (p.stat().st_size, p.stat().st_mtime_ns)
        for p in bundle.rglob("*")
        if p.is_file()
    }
    environment = os.environ.copy()
    environment.pop("PYTHONPATH", None)
    environment.update(
        HANLP_HOME=str(tmp_path / "unrelated-home"),
        HF_HUB_OFFLINE="1",
        TRANSFORMERS_OFFLINE="1",
        PYTHONDONTWRITEBYTECODE="1",
    )
    script = """
import json
import os
import socket
import sys
from pathlib import Path

def deny_network(*args, **kwargs):
    raise AssertionError("resource loading must not access the network")
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.create_connection = deny_network

import torch
torch.set_num_threads(2)
from wordkeep_backend import AnalysisConfig, Post, TextAnalyzer, load_config
assert "hanlp" not in sys.modules
config_path = Path(sys.argv[1])
config = load_config(config_path)
received = json.loads(config_path.read_text())["analysis"]
assert AnalysisConfig.from_mapping(received, base_dir=config_path.parent) == config
analyzer = TextAnalyzer(config)
texts = [
    "我不喜欢这家餐厅，吃完后不舒服。",
    "望远镜观测星云，露营归来很惬意，烘焙和潜水让我满足。",
    "网页链接，真的喜欢咖啡和编程，猫在窗边，我很累。",
    "很可爱，我爱编程。",
]
posts = [Post(str(i), text) for i, text in enumerate(texts * 2)]
posts.append(Post("rare", "今天读了再见菈菈，喜欢伶。"))
result = analyzer.analyze(posts)
assert Path(os.environ["HANLP_HOME"]) == config.hanlp_home
annotation = analyzer._annotator.annotate(["我不太喜欢这个剧情。"], frozenset())[0]
assert "这个" in [t.text for t in annotation.tokens]
assert all(annotation.text[t.start:t.end] == t.text for t in annotation.tokens)
from importlib.metadata import distribution
editable = json.loads(distribution("wordkeep-backend").read_text("direct_url.json"))
assert editable["dir_info"]["editable"] is True
print(json.dumps(result.frequencies, ensure_ascii=False))
"""
    try:
        completed = subprocess.run(
            [sys.executable, "-c", script, str(bundle / "config.json")],
            cwd=tmp_path,
            env=environment,
            capture_output=True,
            text=True,
            check=True,
            timeout=120,
        )
        after = {
            str(p.relative_to(bundle)): (p.stat().st_size, p.stat().st_mtime_ns)
            for p in bundle.rglob("*")
            if p.is_file()
        }
        assert after == before
    finally:
        for path in entries:
            path.chmod(0o755 if path.is_dir() else 0o644)
    frequencies = json.loads(completed.stdout.splitlines()[-1])
    assert {
        "望远镜",
        "星云",
        "露营",
        "惬意",
        "烘焙",
        "潜水",
        "满足",
        "咖啡",
        "编程",
        "不喜欢",
        "不舒服",
        "猫",
        "累",
        "再见菈菈",
        "伶",
        "爱",
        "可爱",
    } <= frequencies.keys()
    assert not {"网页链接", "网页", "链接", "真的", "舒服"} & frequencies.keys()
    assert frequencies["喜欢"] == 3
    assert frequencies["再见菈菈"] == 1
    assert frequencies["可爱"] == 2
    assert frequencies["爱"] == 2


@pytest.mark.parametrize(
    "missing",
    [
        "transformers/electra_zh_small_20210706_125427/vocab.txt",
        "utils/char_table_20210602_202632.json",
    ],
)
def test_missing_support_resource_fails_before_hanlp_load(
    tmp_path, monkeypatch, missing
):
    config = model_config(tmp_path)
    for name in REQUIRED_RESOURCES:
        if name != missing:
            path = config.hanlp_home / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()

    def unexpected_load(*args, **kwargs):
        pytest.fail("incomplete resources must not reach HanLP or its downloader")

    monkeypatch.setitem(sys.modules, "hanlp", SimpleNamespace(load=unexpected_load))
    with pytest.raises(FileNotFoundError, match="resource is missing"):
        HanLPAnnotator(config)
