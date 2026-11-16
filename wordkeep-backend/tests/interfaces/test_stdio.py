"""Real installed-worker pipes, protocol framing and local-model integration."""

import base64
import json
import os
import subprocess
import sys
from contextlib import contextmanager
from io import BytesIO
from queue import Queue
from threading import Thread

import pytest
from PIL import Image
from wordcloud.wordcloud import FONT_PATH

from wordkeep_backend import load_config
from wordkeep_backend.core.hanlp_backend import MODEL_DIRECTORY
from wordkeep_backend.interfaces import rpc
from wordkeep_backend.interfaces.stdio import serve


def environment():
    result = os.environ.copy()
    result.pop("PYTHONPATH", None)
    result.update(PYTHONDONTWRITEBYTECODE="1", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2")
    return result


@contextmanager
def worker(cwd, script=None):
    command = [sys.executable, "-u"]
    command += ["-c", script] if script else ["-m", "wordkeep_backend.interfaces.stdio"]
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        env=environment(),
    )
    replies = Queue()
    errors = []

    def read_replies():
        for line in process.stdout:
            replies.put(line)
        replies.put(None)

    def read_errors():
        errors.append(process.stderr.read())

    readers = [
        Thread(target=read_replies, daemon=True),
        Thread(target=read_errors, daemon=True),
    ]
    for reader in readers:
        reader.start()

    def call(method, params=None, request_id="request", *, fragment=False):
        message = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            message["params"] = params
        data = json.dumps(message, ensure_ascii=False).encode("utf-8") + b"\n"
        if fragment:
            index = data.index("中".encode()) + 1
            process.stdin.write(data[:index])
            process.stdin.flush()
            process.stdin.write(data[index:])
        else:
            process.stdin.write(data)
        process.stdin.flush()
        line = replies.get(timeout=60)
        assert line is not None, b"".join(errors).decode("utf-8", errors="replace")
        return json.loads(line)

    try:
        yield call, process, replies, errors
    finally:
        try:
            process.stdin.close()
            process.wait(timeout=15)
        except subprocess.TimeoutExpired, BrokenPipeError:
            process.kill()
            process.wait(timeout=15)
        for reader in readers:
            reader.join(timeout=5)
        process.stdout.close()
        process.stderr.close()


def test_stream_recovers_after_parse_errors_and_ignores_notifications(monkeypatch):
    monkeypatch.setattr(rpc, "list_colormaps", lambda: ("ocean",))
    source = BytesIO(
        b'\ninvalid json\n\xff\n{"jsonrpc":"2.0","id":NaN,"method":"colormaps.list"}\n'
        b'{"jsonrpc":"2.0","method":"colormaps.list"}\n'
        b'[{"jsonrpc":"2.0","id":"batch","method":"colormaps.list"}]\n'
        b'{"jsonrpc":"2.0","id":"last","method":"colormaps.list"}\n'
    )

    class Output(BytesIO):
        flush_count = 0

        def flush(self):
            self.flush_count += 1
            super().flush()

    output = Output()
    serve(source, output)
    messages = [json.loads(line) for line in output.getvalue().splitlines()]
    assert [item["error"]["code"] for item in messages[:3]] == [-32700] * 3
    assert messages[3][0]["id"] == "batch"
    assert messages[4] == {"jsonrpc": "2.0", "id": "last", "result": ["ocean"]}
    assert output.flush_count == 5


def test_installed_module_replies_before_eof_and_accepts_fragmented_utf8(tmp_path):
    with worker(tmp_path) as (call, process, replies, errors):
        first = call("colormaps.list", request_id="中文\nid", fragment=True)
        assert first["id"] == "中文\nid"
        assert "ocean" in first["result"]
        assert process.poll() is None
        second = call("analysis.analyze", {"posts": []}, request_id=2)
        assert second["error"]["code"] == -32001
        assert second["id"] == 2
        assert replies.empty()
    assert process.returncode == 0


def test_python_and_native_stdout_are_redirected_to_stderr(tmp_path):
    script = """
import os
from wordkeep_backend.interfaces import rpc, stdio

def noisy_colormaps():
    print("python diagnostic", flush=True)
    os.write(1, b"native diagnostic")
    return ("ocean",)
rpc.list_colormaps = noisy_colormaps
stdio.main()
"""
    with worker(tmp_path, script) as (call, process, replies, errors):
        assert call("colormaps.list")["result"] == ["ocean"]
        assert call("colormaps.list")["result"] == ["ocean"]
        assert replies.empty()
    assert process.returncode == 0
    assert b"python diagnostic" in b"".join(errors)
    assert b"native diagnostic" in b"".join(errors)


@pytest.mark.integration
def test_worker_runs_analysis_and_masked_rendering_offline(tmp_path, app_config_path):
    config = load_config(app_config_path)
    if not (config.hanlp_home / MODEL_DIRECTORY / "model.pt").is_file():
        pytest.skip("application model resources are not installed")
    # A personal term occurring once must be explicitly supplied by the caller.
    config.dictionary_path.write_text("上海图书馆\n", encoding="utf-8")
    script = """
import os
import runpy
import socket
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
def deny_network(*args, **kwargs):
    raise AssertionError("worker must use local resources")
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.create_connection = deny_network
runpy.run_module("wordkeep_backend.interfaces.stdio", run_name="__main__")
"""
    mask = BytesIO()
    Image.new("L", (320, 180), 0).save(mask, format="PNG")
    with worker(tmp_path, script) as (call, process, replies, errors):
        initialized = call(
            "initialize",
            {
                "resource_root": str(app_config_path.parent),
                "analysis": json.loads(app_config_path.read_text())["analysis"],
            },
        )
        assert initialized["result"] == {"initialized": True}
        analysis = call(
            "analysis.analyze",
            {
                "posts": [
                    {"id": "1", "text": "喜欢咖啡，也喜欢上海图书馆。"},
                    {"id": "2", "text": "今天又喝了咖啡。"},
                ]
            },
        )["result"]
        assert analysis["frequencies"] == {"咖啡": 2, "喜欢": 2, "上海图书馆": 1}
        assert analysis["post_count"] == 2
        generated = call(
            "wordcloud.generate",
            {
                "frequencies": analysis["frequencies"],
                "config": {"font_path": str(FONT_PATH), "scale": 2},
                "mask_base64": base64.b64encode(mask.getvalue()).decode("ascii"),
            },
        )["result"]
        assert generated["rendered_words"] == ["咖啡", "喜欢", "上海图书馆"]
        with Image.open(
            BytesIO(base64.b64decode(generated["png_base64"], validate=True))
        ) as image:
            image.load()
            assert image.format == "PNG" and image.mode == "RGB"
            assert image.size == (generated["width"], generated["height"]) == (640, 360)
        bad_scale = call(
            "wordcloud.generate",
            {
                "frequencies": analysis["frequencies"],
                "config": {"font_path": str(FONT_PATH), "scale": 0.1},
            },
        )
        assert bad_scale["error"]["code"] == -32602
        assert call("analysis.analyze", {"posts": []})["result"]["frequencies"] == {}
        assert "ocean" in call("colormaps.list")["result"]
    assert process.returncode == 0
