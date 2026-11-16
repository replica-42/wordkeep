"""UTF-8 JSON lines over stdin/stdout: python -m wordkeep_backend.interfaces.stdio."""

import json
import logging
import os
import sys
from contextlib import redirect_stdout
from typing import BinaryIO, NoReturn

from wordkeep_backend.interfaces.rpc import RpcDispatcher, error_response


def _reject_constant(value: str) -> NoReturn:
    raise ValueError(f"non-JSON numeric constant: {value}")


def serve(
    source: BinaryIO, destination: BinaryIO, dispatcher: RpcDispatcher | None = None
) -> None:
    """Process complete lines sequentially and flush each response until stdin EOF."""
    dispatcher = dispatcher or RpcDispatcher()
    response: dict[str, object] | list[dict[str, object]] | None
    for line in source:
        if not line.strip():
            continue
        try:
            request = json.loads(line.decode("utf-8"), parse_constant=_reject_constant)
        except ValueError:
            response = error_response(None, -32700, "Parse error")
        else:
            with redirect_stdout(sys.stderr):
                response = dispatcher.handle(request)
        if response is not None:
            encoded = json.dumps(response, separators=(",", ":"), allow_nan=False)
            destination.write(encoded.encode("utf-8") + b"\n")
            destination.flush()


def main() -> None:
    # Keep a private protocol pipe; native-library writes to fd 1 become stderr too.
    sys.stdout.flush()
    try:
        with os.fdopen(os.dup(sys.stdout.fileno()), "wb") as protocol:
            os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
            logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
            serve(sys.stdin.buffer, protocol)
    except BrokenPipeError:
        # The parent has closed its receiving pipe; the worker can exit normally.
        pass


if __name__ == "__main__":
    main()
