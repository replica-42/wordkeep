"""Log rotation and byte limits."""

import logging

from wordkeep_backend.interfaces.runtime import LOG_BYTES, BoundedLogHandler


def test_unicode_and_oversized_records_respect_rotation_limit(tmp_path):
    assert LOG_BYTES <= 25_000_000
    handler = BoundedLogHandler(
        tmp_path / "backend.log", maxBytes=200, backupCount=3, encoding="utf-8"
    )
    handler.setLevel(logging.WARNING)
    logger = logging.Logger("runtime-test", level=logging.DEBUG)
    logger.addHandler(handler)
    logger.info("not recorded")
    assert (tmp_path / "backend.log").stat().st_size == 0
    for _ in range(12):
        logger.error("中文" * 300)
    handler.close()
    files = list(tmp_path.iterdir())
    assert len(files) == 4
    assert all(path.stat().st_size <= 200 for path in files)
    assert all(path.read_text(encoding="utf-8").endswith("\n") for path in files)
