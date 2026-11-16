"""Application-owned caches and bounded file logging for the desktop worker."""

import logging
import os
import sys
from io import TextIOWrapper
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_BYTES = 25_000_000
LOG_BACKUPS = 3
LOG_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR"}


class BoundedLogHandler(RotatingFileHandler):
    """Rotate by encoded bytes, including multibyte text and oversized records."""

    def _open(self) -> TextIOWrapper:
        # Keep byte accounting identical on Windows and macOS.
        stream = super()._open()
        stream.reconfigure(newline="\n")
        return stream

    def format(self, record: logging.LogRecord) -> str:
        text = super().format(record)
        limit = min(64_000, self.maxBytes - 1)
        return text.encode("utf-8")[:limit].decode("utf-8", errors="ignore")

    def shouldRollover(self, record: logging.LogRecord) -> bool:
        if self.stream is None:
            self.stream = self._open()
        self.stream.seek(0, 2)
        return (
            self.stream.tell() + len((self.format(record) + "\n").encode())
            > self.maxBytes
        )


def configure_logging(directory: Path, level: str) -> None:
    if level not in LOG_LEVELS:
        raise ValueError("invalid log level")
    directory.mkdir(parents=True, exist_ok=True)
    handler = BoundedLogHandler(
        directory / "backend.log",
        maxBytes=LOG_BYTES,
        backupCount=LOG_BACKUPS,
        encoding="utf-8",
    )
    handler.setLevel(level)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    logging.basicConfig(level=level, handlers=[handler], force=True)
    logging.captureWarnings(True)


def configure_runtime(user_data: Path, level: str) -> None:
    if not user_data.is_absolute():
        raise ValueError("user data directory must be absolute")
    sys.dont_write_bytecode = True
    # Load bytecode precompiled beside the bundled sources.
    sys.pycache_prefix = None
    os.environ.pop("PYTHONPYCACHEPREFIX", None)
    cache = user_data / "cache" / "python"
    for variable, subdirectory in {
        "MPLCONFIGDIR": "matplotlib",
        "HF_HOME": "huggingface",
        "TORCH_HOME": "torch",
        "XDG_CACHE_HOME": "xdg",
        "TMPDIR": "tmp",
        "TEMP": "tmp",
        "TMP": "tmp",
    }.items():
        path = cache / subdirectory
        path.mkdir(parents=True, exist_ok=True)
        os.environ[variable] = str(path)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    configure_logging(user_data / "logs", level)
    # Send logging records to rotating files and discard library progress streams.
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
    sys.stderr = open(os.devnull, "w", encoding="utf-8")
