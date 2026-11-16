"""Application-supplied settings and resource path resolution."""

import json
import math
from collections.abc import Mapping
from dataclasses import dataclass, fields
from pathlib import Path


def _resource_path(value: object, name: str, base_dir: Path) -> Path:
    if not isinstance(value, (str, Path)) or not str(value).strip():
        raise ValueError(f"{name} must be a nonempty file-system path")
    path = Path(value).expanduser()
    return (path if path.is_absolute() else base_dir / path).resolve()


@dataclass(frozen=True, slots=True)
class AnalysisConfig:
    """Resolved resources and inference settings for one Python worker."""

    hanlp_home: Path
    stopwords_path: Path
    dictionary_path: Path
    batch_size: int = 32

    def __post_init__(self) -> None:
        for name in ("hanlp_home", "stopwords_path", "dictionary_path"):
            path = getattr(self, name)
            if not isinstance(path, Path) or not path.is_absolute():
                raise ValueError(f"{name} must be an absolute Path")
        if type(self.batch_size) is not int or self.batch_size < 1:
            raise ValueError("batch_size must be a positive integer")

    @classmethod
    def from_mapping(
        cls, values: Mapping[str, object], *, base_dir: Path
    ) -> AnalysisConfig:
        """Resolve an application's decoded JSON section against its resource root."""
        if not isinstance(values, Mapping):
            raise ValueError("analysis configuration must be an object")
        if not base_dir.is_absolute():
            raise ValueError("base_dir must be an absolute Path")
        unknown = values.keys() - {field.name for field in fields(cls)}
        if unknown:
            raise ValueError(f"unknown analysis settings: {', '.join(sorted(unknown))}")
        required = {"hanlp_home", "stopwords_path", "dictionary_path"}
        missing = required - values.keys()
        if missing:
            raise ValueError(f"missing analysis settings: {', '.join(sorted(missing))}")
        batch_size = values.get("batch_size", 32)
        if type(batch_size) is not int:
            raise ValueError("batch_size must be a positive integer")
        return cls(
            hanlp_home=_resource_path(values["hanlp_home"], "hanlp_home", base_dir),
            stopwords_path=_resource_path(
                values["stopwords_path"], "stopwords_path", base_dir
            ),
            dictionary_path=_resource_path(
                values["dictionary_path"], "dictionary_path", base_dir
            ),
            batch_size=batch_size,
        )


def _positive_integer(value: object, name: str) -> int:
    if type(value) is not int or value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _validate_scale(value: object) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError("scale must be a finite number greater than or equal to 1")
    scale = float(value)
    if not math.isfinite(scale) or scale < 1:
        raise ValueError("scale must be a finite number greater than or equal to 1")
    return scale


@dataclass(frozen=True, slots=True)
class WordCloudConfig:
    """Font and layout settings; dimensions are multiplied by scale on export."""

    font_path: Path
    width: int = 1920
    height: int = 1080
    max_words: int = 400
    colormap: str = "ocean"
    scale: float = 1

    def __post_init__(self) -> None:
        if not isinstance(self.font_path, Path) or not self.font_path.is_absolute():
            raise ValueError("font_path must be an absolute Path")
        for name in ("width", "height", "max_words"):
            _positive_integer(getattr(self, name), name)
        _validate_scale(self.scale)
        if not isinstance(self.colormap, str) or not self.colormap.strip():
            raise ValueError("colormap must be a nonempty name")

    @classmethod
    def from_mapping(
        cls, values: Mapping[str, object], *, base_dir: Path
    ) -> WordCloudConfig:
        """Resolve a selected system font or custom font against the resource root."""
        if not isinstance(values, Mapping):
            raise ValueError("wordcloud configuration must be an object")
        if not base_dir.is_absolute():
            raise ValueError("base_dir must be an absolute Path")
        unknown = values.keys() - {field.name for field in fields(cls)}
        if unknown:
            raise ValueError(
                f"unknown wordcloud settings: {', '.join(sorted(unknown))}"
            )
        if "font_path" not in values:
            raise ValueError("missing wordcloud settings: font_path")
        colormap = values.get("colormap", "ocean")
        if not isinstance(colormap, str):
            raise ValueError("colormap must be a nonempty name")
        return cls(
            font_path=_resource_path(values["font_path"], "font_path", base_dir),
            width=_positive_integer(values.get("width", 1920), "width"),
            height=_positive_integer(values.get("height", 1080), "height"),
            max_words=_positive_integer(values.get("max_words", 400), "max_words"),
            colormap=colormap,
            scale=_validate_scale(values.get("scale", 1)),
        )


def _load_section(path: str | Path, name: str) -> tuple[dict[str, object], Path]:
    config_path = Path(path).expanduser().resolve()
    with config_path.open(encoding="utf-8-sig") as stream:
        payload = json.load(stream)
    if not isinstance(payload, dict) or not isinstance(payload.get(name), dict):
        raise ValueError(f"configuration must contain a {name} object")
    return payload[name], config_path.parent


def load_config(path: str | Path) -> AnalysisConfig:
    """Read the analysis section of an application JSON configuration file."""
    values, base_dir = _load_section(path, "analysis")
    return AnalysisConfig.from_mapping(values, base_dir=base_dir)


def load_wordcloud_config(path: str | Path) -> WordCloudConfig:
    """Read the wordcloud section of the same application configuration file."""
    values, base_dir = _load_section(path, "wordcloud")
    return WordCloudConfig.from_mapping(values, base_dir=base_dir)
