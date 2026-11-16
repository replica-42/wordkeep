"""HTTP transport tests using in-process ASGI requests."""

import asyncio
import json

from wordkeep_backend.interfaces.http import RpcHttpApplication

TOKEN = "a" * 64


def request(
    app,
    body=b"{}",
    *,
    token=TOKEN,
    path="/rpc",
    method="POST",
    content_type=b"application/json",
):
    events = []
    chunks = [body[:3], body[3:]]

    async def receive():
        part = chunks.pop(0)
        return {"type": "http.request", "body": part, "more_body": bool(chunks)}

    async def send(event):
        events.append(event)

    asyncio.run(
        app(
            {
                "type": "http",
                "path": path,
                "method": method,
                "headers": [
                    (b"authorization", f"Bearer {token}".encode()),
                    (b"content-type", content_type),
                ],
            },
            receive,
            send,
        )
    )
    return events[0]["status"], json.loads(events[1]["body"]) if events[1][
        "body"
    ] else None


def test_authentication_is_required_even_for_health():
    app = RpcHttpApplication(TOKEN)
    assert request(app, token="wrong", path="/health", method="GET")[0] == 401
    assert request(app, path="/health", method="GET") == (200, {"ready": True})
    assert request(app, content_type=b"text/plain")[0] == 415
    assert request(app, path="/other")[0] == 404


def test_rpc_errors_and_notifications_keep_the_protocol():
    app = RpcHttpApplication(TOKEN)
    status, response = request(app, b"not JSON")
    assert status == 200 and response["error"]["code"] == -32700
    _, response = request(app, b'{"jsonrpc":"2.0","id":2,"method":"unknown"}')
    assert response["id"] == 2 and response["error"]["code"] == -32601
    assert request(app, b'{"jsonrpc":"2.0","method":"unknown"}') == (204, None)


def test_request_size_is_bounded(monkeypatch):
    monkeypatch.setattr("wordkeep_backend.interfaces.http.MAX_REQUEST_BYTES", 4)
    assert request(RpcHttpApplication(TOKEN), b"12345")[0] == 413


def test_inference_is_sequential_and_does_not_block_health():
    import threading

    started = threading.Event()
    finish = threading.Event()

    class Dispatcher:
        def handle(self, message):
            started.set()
            assert finish.wait(3)
            return {"jsonrpc": "2.0", "id": message["id"], "result": "中文"}

    async def run():
        app = RpcHttpApplication(TOKEN, Dispatcher())
        replies = []

        async def receive():
            return {"type": "http.request", "body": b'{"id":1}'}

        async def send(value):
            replies.append(value)

        scope = {
            "type": "http",
            "path": "/rpc",
            "method": "POST",
            "headers": [
                (b"authorization", f"Bearer {TOKEN}".encode()),
                (b"content-type", b"application/json"),
            ],
        }
        task = asyncio.create_task(app(scope, receive, send))
        await asyncio.to_thread(started.wait, 2)
        health = []

        async def health_send(value):
            health.append(value)

        await app({**scope, "path": "/health", "method": "GET"}, receive, health_send)
        assert health[0]["status"] == 200
        finish.set()
        await task
        assert json.loads(replies[1]["body"])["result"] == "中文"

    asyncio.run(run())
