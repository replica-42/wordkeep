"""JSON-RPC dispatch and wire-data conversion for a sequential Python worker."""

import base64
import inspect
import logging
import math
from collections.abc import Callable
from pathlib import Path

from wordkeep_backend.core import (
    AnalysisConfig,
    Post,
    TextAnalyzer,
    WordCloudConfig,
    generate_wordcloud,
    list_colormaps,
    list_system_fonts,
)

logger = logging.getLogger(__name__)


class RpcError(Exception):
    def __init__(self, code: int, message: str, data: object = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


def error_response(
    request_id: object, code: int, message: str, data: object = None
) -> dict[str, object]:
    error: dict[str, object] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def _object(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object with string keys")
    return value


def _valid_id(value: object) -> bool:
    return (
        value is None
        or type(value) in (str, int)
        or (type(value) is float and math.isfinite(value))
    )


class RpcDispatcher:
    """Manage one analyzer and dispatch application RPC methods."""

    def __init__(self) -> None:
        self._resource_root: Path | None = None
        self._analyzer: TextAnalyzer | None = None
        self._methods: dict[str, Callable[..., object]] = {
            "initialize": self._initialize,
            "analysis.analyze": self._analyze,
            "wordcloud.generate": self._generate,
            "fonts.list": self._fonts,
            "colormaps.list": self._colormaps,
        }

    def handle(
        self, message: object
    ) -> dict[str, object] | list[dict[str, object]] | None:
        if isinstance(message, list):
            if not message:
                return error_response(None, -32600, "Invalid Request")
            replies = [
                reply for item in message if (reply := self._request(item)) is not None
            ]
            return replies or None
        return self._request(message)

    def _request(self, request: object) -> dict[str, object] | None:
        if (
            not isinstance(request, dict)
            or request.get("jsonrpc") != "2.0"
            or not isinstance(request.get("method"), str)
            or not _valid_id(request.get("id"))
            or not isinstance(request.get("params", {}), (dict, list))
        ):
            return error_response(None, -32600, "Invalid Request")
        request_id = request.get("id")
        method = request["method"]
        params = request.get("params", {})
        try:
            handler = self._methods.get(method)
            if handler is None:
                raise RpcError(-32601, "Method not found")
            try:
                signature = inspect.signature(handler)
                arguments = (
                    signature.bind(**params)
                    if isinstance(params, dict)
                    else signature.bind(*params)
                )
            except TypeError as error:
                raise RpcError(-32602, "Invalid params", str(error)) from error
            result = handler(*arguments.args, **arguments.kwargs)
            response = {"jsonrpc": "2.0", "id": request_id, "result": result}
        except RpcError as error:
            response = error_response(request_id, error.code, str(error), error.data)
        except (ValueError, OverflowError) as error:
            response = error_response(request_id, -32602, "Invalid params", str(error))
        except (OSError, RuntimeError) as error:
            logger.warning("%s failed: %s", method, error)
            response = error_response(
                request_id,
                -32000,
                "Operation failed",
                {"type": type(error).__name__, "message": str(error)},
            )
        except Exception:
            logger.exception("Unexpected failure in %s", method)
            response = error_response(request_id, -32603, "Internal error")
        # An explicit null ID is a request; an absent ID is a notification.
        return response if "id" in request else None

    def _initialize(self, resource_root: object, analysis: object) -> dict[str, object]:
        if not isinstance(resource_root, str) or not resource_root.strip():
            raise ValueError("resource_root must be an absolute path string")
        root = Path(resource_root).expanduser()
        if not root.is_absolute():
            raise ValueError("resource_root must be an absolute path string")
        root = root.resolve()
        config = AnalysisConfig.from_mapping(
            _object(analysis, "analysis"), base_dir=root
        )
        if self._analyzer is not None:
            if root != self._resource_root or config != self._analyzer.config:
                raise RpcError(
                    -32002,
                    "Already initialized; restart the worker to change configuration",
                )
        else:
            analyzer = TextAnalyzer(config)
            self._analyzer = analyzer
            self._resource_root = root
        return {"initialized": True}

    def _analyze(self, posts: object) -> dict[str, object]:
        if self._analyzer is None:
            raise RpcError(-32001, "Backend is not initialized")
        if not isinstance(posts, list):
            raise ValueError("posts must be an array")
        parsed = []
        for index, item in enumerate(posts):
            post = _object(item, f"posts[{index}]")
            if post.keys() != {"id", "text"}:
                raise ValueError(f"posts[{index}] must contain only id and text")
            post_id, text = post["id"], post["text"]
            if not isinstance(post_id, str) or not isinstance(text, str):
                raise ValueError(f"posts[{index}].id and text must be strings")
            parsed.append(Post(post_id, text))
        result = self._analyzer.analyze(parsed)
        return {
            "frequencies": result.frequencies,
            "terms": [
                {
                    "text": term.text,
                    "occurrences": term.occurrences,
                    "document_count": term.document_count,
                    "sources": sorted(term.sources),
                    "examples": list(term.examples),
                }
                for term in result.terms
            ],
            "post_count": result.post_count,
            "sentence_count": result.sentence_count,
        }

    def _generate(
        self, frequencies: object, config: object, mask_base64: object = None
    ) -> dict[str, object]:
        if self._resource_root is None:
            raise RpcError(-32001, "Backend is not initialized")
        counts = {}
        for word, count in _object(frequencies, "frequencies").items():
            if type(count) is not int:
                raise ValueError(f"frequency for {word!r} must be a positive integer")
            counts[word] = count
        settings = WordCloudConfig.from_mapping(
            _object(config, "config"), base_dir=self._resource_root
        )
        mask = None
        if mask_base64 is not None:
            if not isinstance(mask_base64, str):
                raise ValueError("mask_base64 must be a base64 string or null")
            try:
                mask = base64.b64decode(mask_base64, validate=True)
            except ValueError as error:
                raise ValueError("mask_base64 must contain valid base64") from error
        result = generate_wordcloud(counts, settings, mask=mask)
        return {
            "png_base64": base64.b64encode(result.png).decode("ascii"),
            "width": result.width,
            "height": result.height,
            "rendered_words": list(result.rendered_words),
        }

    def _fonts(self) -> list[dict[str, str]]:
        return [
            {"name": font.name, "path": str(font.path)} for font in list_system_fonts()
        ]

    def _colormaps(self) -> list[str]:
        return list(list_colormaps())
