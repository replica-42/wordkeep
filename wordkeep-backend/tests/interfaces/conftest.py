import pytest


@pytest.fixture
def rpc_initialization(tmp_path):
    root = tmp_path / "应用 Resources"
    root.mkdir()
    (root / "dict.txt").write_text("上海图书馆\n", encoding="utf-8")
    (root / "stopwords.txt").write_text("今天\n", encoding="utf-8")
    return {
        "resource_root": str(root),
        "analysis": {
            "hanlp_home": "hanlp",
            "dictionary_path": "dict.txt",
            "stopwords_path": "stopwords.txt",
        },
    }
