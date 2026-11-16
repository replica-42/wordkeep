"""UTF-8 word lists supplied by the application."""

from collections.abc import Iterable
from pathlib import Path


def _words(values: Iterable[str]) -> frozenset[str]:
    result = set()
    for number, value in enumerate(values, 1):
        if not isinstance(value, str):
            raise ValueError(f"word list entry {number} must be text")
        word = value.strip()
        if any(ord(char) < 32 for char in word):
            raise ValueError(f"word list entry {number} contains a control character")
        if word:
            result.add(word)
    return frozenset(result)


def load_word_list(path: str | Path) -> frozenset[str]:
    """Read UTF-8, one term per line; invalid entries abort loading."""
    with Path(path).open(encoding="utf-8-sig") as stream:
        return _words(line.rstrip("\r\n") for line in stream)
