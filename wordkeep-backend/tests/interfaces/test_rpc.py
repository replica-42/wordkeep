"""Protocol contracts and conversion at the interface/functional boundary."""

import base64
import json
from pathlib import Path

import pytest

from wordkeep_backend.core import AnalysisResult, SystemFont, Term, WordCloudResult
from wordkeep_backend.interfaces import rpc
from wordkeep_backend.interfaces.rpc import RpcDispatcher


def request(method, params=None, request_id="request"):
    message = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        message["params"] = params
    return message


@pytest.fixture
def dispatcher(monkeypatch):
    monkeypatch.setattr(rpc, "list_colormaps", lambda: ("ocean", "viridis"))
    return RpcDispatcher()


def test_initialization_reuses_analyzer_and_serializes_analysis_results(
    dispatcher, rpc_initialization, monkeypatch
):
    created, calls = [], []

    class Analyzer:
        def __init__(self, config):
            self.config = config
            created.append(self)

        def analyze(self, posts):
            calls.append(posts)
            return AnalysisResult(
                (
                    Term(
                        "喜欢",
                        2,
                        1,
                        frozenset({"entity", "dictionary"}),
                        ("喜欢\n咖啡",),
                    ),
                ),
                1,
                2,
            )

    monkeypatch.setattr(rpc, "TextAnalyzer", Analyzer)
    init = request("initialize", rpc_initialization)
    assert dispatcher.handle(init)["result"] == {"initialized": True}
    assert dispatcher.handle(init)["result"] == {"initialized": True}
    assert len(created) == 1
    assert (
        created[0].config.hanlp_home
        == Path(rpc_initialization["resource_root"]) / "hanlp"
    )
    posts = [{"id": "1", "text": "喜欢\n咖啡"}]
    first = dispatcher.handle(request("analysis.analyze", {"posts": posts}))
    second = dispatcher.handle(request("analysis.analyze", [posts]))
    assert first == second
    assert len(created) == 1 and len(calls) == 2
    assert calls[0][0].id == "1" and calls[0][0].text == "喜欢\n咖啡"
    assert json.loads(json.dumps(first))["result"] == {
        "frequencies": {"喜欢": 2},
        "terms": [
            {
                "text": "喜欢",
                "occurrences": 2,
                "document_count": 1,
                "sources": ["dictionary", "entity"],
                "examples": ["喜欢\n咖啡"],
            }
        ],
        "post_count": 1,
        "sentence_count": 2,
    }
    changed = {
        **rpc_initialization,
        "analysis": {**rpc_initialization["analysis"], "batch_size": 2},
    }
    assert dispatcher.handle(request("initialize", changed))["error"]["code"] == -32002
    assert dispatcher.handle(init)["result"]["initialized"] is True


def test_initialization_failure_leaves_worker_available(dispatcher, rpc_initialization):
    root = Path(rpc_initialization["resource_root"])
    (root / "dict.txt").unlink()
    response = dispatcher.handle(request("initialize", rpc_initialization))
    assert response["error"]["code"] == -32000
    assert response["error"]["data"]["type"] == "FileNotFoundError"
    assert (
        dispatcher.handle(request("analysis.analyze", {"posts": []}))["error"]["code"]
        == -32001
    )
    (root / "dict.txt").write_text("")
    assert dispatcher.handle(request("initialize", rpc_initialization))["result"][
        "initialized"
    ]
    assert dispatcher.handle(request("analysis.analyze", {"posts": []}))["result"] == {
        "frequencies": {},
        "terms": [],
        "post_count": 0,
        "sentence_count": 0,
    }


def test_initialization_accepts_positional_parameters(dispatcher, rpc_initialization):
    reply = dispatcher.handle(
        request(
            "initialize",
            [rpc_initialization["resource_root"], rpc_initialization["analysis"]],
        )
    )
    assert reply["result"] == {"initialized": True}


@pytest.mark.parametrize("root", [None, "", "relative", 1])
def test_initialization_requires_explicit_absolute_root(
    dispatcher, rpc_initialization, root
):
    reply = dispatcher.handle(
        request("initialize", {**rpc_initialization, "resource_root": root})
    )
    assert reply["error"]["code"] == -32602


def test_font_and_colormap_queries_work_before_initialization(
    dispatcher, monkeypatch, tmp_path
):
    path = tmp_path / "中文字体.ttf"
    monkeypatch.setattr(
        rpc, "list_system_fonts", lambda: (SystemFont("中文字体", path),)
    )
    assert dispatcher.handle(request("fonts.list"))["result"] == [
        {"name": "中文字体", "path": str(path)}
    ]
    assert dispatcher.handle(request("colormaps.list", []))["result"] == [
        "ocean",
        "viridis",
    ]
    assert (
        dispatcher.handle(request("analysis.analyze", {"posts": []}))["error"]["code"]
        == -32001
    )
    assert (
        dispatcher.handle(
            request("wordcloud.generate", {"frequencies": {}, "config": {}})
        )["error"]["code"]
        == -32001
    )


def test_generate_decodes_mask_and_encodes_only_transport_data(
    dispatcher, rpc_initialization, monkeypatch
):
    dispatcher.handle(request("initialize", rpc_initialization))
    seen = []

    def generate(frequencies, config, *, mask):
        seen.append((frequencies, config, mask))
        return WordCloudResult(b"PNG image bytes", 640, 360, ("咖啡",))

    monkeypatch.setattr(rpc, "generate_wordcloud", generate)
    reply = dispatcher.handle(
        request(
            "wordcloud.generate",
            {
                "frequencies": {"咖啡": 1},
                "config": {"font_path": "fonts/selected.ttf", "scale": 2},
                "mask_base64": base64.b64encode(b"mask image bytes").decode("ascii"),
            },
        )
    )
    result = reply["result"]
    assert base64.b64decode(result["png_base64"]) == b"PNG image bytes"
    assert result["rendered_words"] == ["咖啡"]
    assert (result["width"], result["height"]) == (640, 360)
    assert seen[0][0] == {"咖啡": 1}
    assert (
        seen[0][1].font_path
        == Path(rpc_initialization["resource_root"]) / "fonts/selected.ttf"
    )
    assert seen[0][1].scale == 2
    assert seen[0][2] == b"mask image bytes"
    dispatcher.handle(
        request("wordcloud.generate", [{"咖啡": 1}, {"font_path": "font.ttf"}])
    )
    assert seen[1][2] is None


@pytest.mark.parametrize("mask", ["%%%", "a", "中文", [1, 2]])
def test_invalid_mask_encoding_is_an_invalid_params_error(
    dispatcher, rpc_initialization, mask
):
    dispatcher.handle(request("initialize", rpc_initialization))
    reply = dispatcher.handle(
        request(
            "wordcloud.generate",
            {
                "frequencies": {"coffee": 1},
                "config": {"font_path": "font.ttf"},
                "mask_base64": mask,
            },
        )
    )
    assert reply["error"]["code"] == -32602
    assert "base64" in reply["error"]["data"]


def test_invalid_scale_is_rejected_before_rendering(
    dispatcher, rpc_initialization, monkeypatch
):
    dispatcher.handle(request("initialize", rpc_initialization))

    def unexpected(*args, **kwargs):
        raise AssertionError("invalid scale must not reach the renderer")

    monkeypatch.setattr(rpc, "generate_wordcloud", unexpected)
    response = dispatcher.handle(
        request(
            "wordcloud.generate",
            {
                "frequencies": {"coffee": 1},
                "config": {"font_path": "font.ttf", "scale": 0.1},
            },
        )
    )
    assert response["error"]["code"] == -32602
    assert "scale" in response["error"]["data"]


@pytest.mark.parametrize(
    "posts",
    [
        None,
        {},
        [1],
        [{}],
        [{"id": 1, "text": "text"}],
        [{"id": "1", "text": False}],
        [{"id": "1", "text": "", "other": 1}],
        [{"id": "1", "text": ""}, {"id": "1", "text": ""}],
    ],
)
def test_invalid_posts_abort_request_without_stopping_worker(
    dispatcher, rpc_initialization, posts
):
    dispatcher.handle(request("initialize", rpc_initialization))
    assert (
        dispatcher.handle(request("analysis.analyze", {"posts": posts}))["error"][
            "code"
        ]
        == -32602
    )
    assert "result" in dispatcher.handle(request("analysis.analyze", {"posts": []}))


@pytest.mark.parametrize("request_id", [None, 0, "中文-id", 1.5])
def test_response_ids_are_preserved_including_explicit_null(dispatcher, request_id):
    response = dispatcher.handle(request("colormaps.list", request_id=request_id))
    assert response["id"] == request_id
    assert "result" in response and "error" not in response


@pytest.mark.parametrize(
    "message",
    [
        None,
        1,
        "text",
        True,
        {},
        {"jsonrpc": "1.0", "method": "colormaps.list", "id": 1},
        {"jsonrpc": "2.0", "method": 1},
        {"jsonrpc": "2.0", "method": "colormaps.list", "params": None},
    ],
)
def test_invalid_envelopes_have_null_error_id(dispatcher, message):
    response = dispatcher.handle(message)
    assert response == {
        "jsonrpc": "2.0",
        "id": None,
        "error": {"code": -32600, "message": "Invalid Request"},
    }


@pytest.mark.parametrize("request_id", [True, [], {}, float("nan"), float("inf")])
def test_nonstandard_ids_are_rejected(dispatcher, request_id):
    response = dispatcher.handle(request("colormaps.list", request_id=request_id))
    assert response["error"]["code"] == -32600
    assert response["id"] is None


@pytest.mark.parametrize(
    ("method", "params", "code"),
    [
        ("__getattribute__", {}, -32601),
        ("initialize", {}, -32602),
        ("colormaps.list", [1], -32602),
        ("colormaps.list", {"extra": 1}, -32602),
    ],
)
def test_method_dispatch_is_explicit_and_parameters_are_bound(
    dispatcher, method, params, code
):
    response = dispatcher.handle(request(method, params))
    assert response["error"]["code"] == code
    assert response["id"] == "request"
    assert "result" not in response


def test_notifications_execute_but_never_reply(dispatcher, rpc_initialization):
    notification = request("initialize", rpc_initialization)
    del notification["id"]
    assert dispatcher.handle(notification) is None
    assert dispatcher.handle({"jsonrpc": "2.0", "method": "unknown"}) is None
    assert (
        dispatcher.handle(request("analysis.analyze", {"posts": []}))["result"][
            "post_count"
        ]
        == 0
    )


def test_batches_omit_notifications_and_keep_individual_errors(dispatcher):
    response = dispatcher.handle(
        [
            request("colormaps.list", request_id="ok"),
            {"jsonrpc": "2.0", "method": "colormaps.list"},
            42,
            request("unknown", request_id="missing"),
        ]
    )
    assert [item["id"] for item in response] == ["ok", None, "missing"]
    assert response[1]["error"]["code"] == -32600
    assert response[2]["error"]["code"] == -32601
    assert dispatcher.handle([])["error"]["code"] == -32600
    assert dispatcher.handle([{"jsonrpc": "2.0", "method": "colormaps.list"}]) is None
    assert (
        dispatcher.handle([[request("colormaps.list")]])[0]["error"]["code"] == -32600
    )


def test_unexpected_failures_are_logged_and_do_not_leak_into_results(
    dispatcher, monkeypatch, caplog
):
    def fail():
        raise IndexError("implementation failure")

    monkeypatch.setattr(rpc, "list_colormaps", fail)
    response = dispatcher.handle(request("colormaps.list"))
    assert response["error"] == {"code": -32603, "message": "Internal error"}
    assert "implementation failure" in caplog.text
    monkeypatch.setattr(rpc, "list_colormaps", lambda: ("ocean",))
    assert dispatcher.handle(request("colormaps.list"))["result"] == ["ocean"]
