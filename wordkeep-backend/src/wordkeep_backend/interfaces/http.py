"""Authenticated loopback HTTP transport for the Electron-owned worker."""

import asyncio
import hmac
import json
import logging
import os
import socket
import time
from pathlib import Path
from typing import NoReturn

import uvicorn
from uvicorn._types import ASGIReceiveCallable, ASGISendCallable, Scope

from wordkeep_backend.interfaces.rpc import RpcDispatcher, error_response
from wordkeep_backend.interfaces.runtime import configure_runtime

MAX_REQUEST_BYTES = 128 * 1024 * 1024
LEASE_SECONDS = 60
logger = logging.getLogger(__name__)


def reject_constant(value: str) -> NoReturn:
    raise ValueError(f"invalid JSON constant: {value}")


class RpcHttpApplication:
    def __init__(self, token: str, dispatcher: RpcDispatcher | None = None) -> None:
        if len(token) < 32:
            raise ValueError("a private worker token is required")
        self.token = token
        self.dispatcher = dispatcher or RpcDispatcher()
        self.lock = asyncio.Lock()
        self.last_seen = time.monotonic()

    async def __call__(
        self, scope: Scope, receive: ASGIReceiveCallable, send: ASGISendCallable
    ) -> None:
        if scope["type"] != "http":
            return
        headers = dict(scope["headers"])
        authorization = headers.get(b"authorization", b"")
        if not hmac.compare_digest(authorization, f"Bearer {self.token}".encode()):
            await self.respond(send, 401, {"error": "Unauthorized"})
            return
        self.last_seen = time.monotonic()
        if scope["path"] == "/health" and scope["method"] == "GET":
            await self.respond(send, 200, {"ready": True})
            return
        if scope["path"] != "/rpc" or scope["method"] != "POST":
            await self.respond(send, 404, {"error": "Not found"})
            return
        if headers.get(b"content-type", b"").split(b";")[0] != b"application/json":
            await self.respond(send, 415, {"error": "Expected application/json"})
            return
        body = bytearray()
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                return
            if event["type"] != "http.request":
                continue
            body.extend(event.get("body", b""))
            if len(body) > MAX_REQUEST_BYTES:
                await self.respond(send, 413, {"error": "Request too large"})
                return
            if not event.get("more_body", False):
                break
        try:
            message = json.loads(body.decode("utf-8"), parse_constant=reject_constant)
        except ValueError:
            await self.respond(send, 200, error_response(None, -32700, "Parse error"))
            return
        # Preserve the functional worker's sequential state while keeping health
        # requests responsive during model loading and CPU inference.
        async with self.lock:
            response = await asyncio.to_thread(self.dispatcher.handle, message)
        await self.respond(send, 204 if response is None else 200, response)

    @staticmethod
    async def respond(send: ASGISendCallable, status: int, value: object) -> None:
        body = (
            b"" if value is None else json.dumps(value, allow_nan=False).encode("utf-8")
        )
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


async def serve(token: str, ready_path: Path) -> None:
    application = RpcHttpApplication(token)
    config = uvicorn.Config(
        application,
        host="127.0.0.1",
        port=0,
        loop="asyncio",
        http="h11",
        ws="none",
        lifespan="off",
        log_config=None,
        access_log=False,
        timeout_keep_alive=5,
        limit_concurrency=16,
    )
    server = uvicorn.Server(config)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(16)
        listener.setblocking(False)
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            while not server.started:
                if task.done():
                    await task
                    raise RuntimeError("HTTP worker failed to start")
                await asyncio.sleep(0.02)
            temporary = ready_path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps({"port": listener.getsockname()[1], "pid": os.getpid()}),
                encoding="utf-8",
            )
            temporary.chmod(0o600)
            temporary.replace(ready_path)
            while not task.done():
                if time.monotonic() - application.last_seen > LEASE_SECONDS:
                    logger.warning("Desktop connection expired; stopping worker")
                    logging.shutdown()
                    # Release the model on lease expiry, including active inference.
                    os._exit(0)
                await asyncio.sleep(1)
            await task
        finally:
            ready_path.unlink(missing_ok=True)
            server.should_exit = True


def main() -> None:
    user_data = Path(os.environ["WORDKEEP_USER_DATA"])
    configure_runtime(user_data, os.environ.get("WORDKEEP_LOG_LEVEL", "WARNING"))
    try:
        ready_path = Path(os.environ["WORDKEEP_READY_FILE"])
        if not ready_path.is_absolute():
            raise ValueError("ready file must be absolute")
        asyncio.run(serve(os.environ["WORDKEEP_WORKER_TOKEN"], ready_path))
    except Exception:
        logger.exception("Backend failed")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
