import json
from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def project_root(pytestconfig) -> Path:
    return pytestconfig.rootpath


@pytest.fixture
def app_config_path(tmp_path, project_root):
    project = project_root
    root = tmp_path / "resources"
    (root / "data").mkdir(parents=True)
    for name in ("dict.txt", "stopwords.txt"):
        (root / "data" / name).write_text("", encoding="utf-8")
    payload = json.loads((project / "config.json").read_text())
    payload["analysis"].update(
        hanlp_home=str(project / "data/hanlp"),
        dictionary_path="data/dict.txt",
        stopwords_path="data/stopwords.txt",
    )
    path = root / "config.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path
