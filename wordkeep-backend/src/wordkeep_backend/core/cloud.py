"""Generate horizontal, white-background PNG word clouds from supplied counts."""

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING

from wordkeep_backend.core.config import WordCloudConfig

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class SystemFont:
    name: str
    path: Path


@dataclass(frozen=True, slots=True)
class WordCloudResult:
    png: bytes
    width: int
    height: int
    rendered_words: tuple[str, ...]


def list_system_fonts() -> tuple[SystemFont, ...]:
    """List usable system font files with the name of the face Pillow will render."""
    from matplotlib.font_manager import findSystemFonts
    from PIL import ImageFont

    fonts = []
    paths = {Path(path).resolve() for path in findSystemFonts()}
    for path in sorted(paths):
        try:
            family, style = ImageFont.truetype(str(path)).getname()
        except OSError as error:
            logger.warning("Cannot open system font %s: %s", path, error)
            continue
        name = " ".join(part for part in (family, style) if part) or path.stem
        fonts.append(SystemFont(name, path))
    return tuple(sorted(fonts, key=lambda font: (font.name.casefold(), str(font.path))))


def list_colormaps() -> tuple[str, ...]:
    """Available names for the application's colormap selector."""
    from matplotlib import colormaps

    return tuple(sorted(colormaps))


def _load_mask(data: bytes) -> NDArray[np.uint8]:
    import numpy as np
    from PIL import Image

    if not isinstance(data, bytes):
        raise TypeError("mask must contain encoded image bytes")
    with Image.open(BytesIO(data)) as source:
        rgba = source.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        rgb = Image.alpha_composite(background, rgba).convert("RGB")
        return np.array(rgb, dtype=np.uint8)


def generate_wordcloud(
    frequencies: Mapping[str, int],
    config: WordCloudConfig,
    *,
    mask: bytes | None = None,
) -> WordCloudResult:
    """Render supplied counts; optional mask bytes set canvas size."""
    if not frequencies:
        raise ValueError("wordcloud needs at least one word")
    for word, count in frequencies.items():
        if not isinstance(word, str) or not word.strip():
            raise ValueError("wordcloud terms must be nonempty strings")
        if type(count) is not int or count < 1:
            raise ValueError(f"frequency for {word!r} must be a positive integer")
    if config.colormap not in list_colormaps():
        raise ValueError(f"unknown colormap: {config.colormap}")
    if not config.font_path.is_file():
        raise FileNotFoundError(f"font file is missing: {config.font_path}")

    from wordcloud import WordCloud  # type: ignore[import-untyped]

    mask_array = _load_mask(mask) if mask is not None else None
    cloud = WordCloud(
        font_path=str(config.font_path),
        width=config.width,
        height=config.height,
        mask=mask_array,
        max_words=config.max_words,
        # WordCloud supports float scale; Pylance infers int from its untyped default.
        scale=config.scale,  # pyright: ignore[reportArgumentType]
        colormap=config.colormap,
        prefer_horizontal=1,
        background_color="white",
    )
    ordered = dict(sorted(frequencies.items(), key=lambda item: (-item[1], item[0])))
    cloud.generate_from_frequencies(ordered)
    if not cloud.layout_:
        raise ValueError("no words fit in the canvas or mask")
    image = cloud.to_image()
    output = BytesIO()
    image.save(output, format="PNG")
    return WordCloudResult(
        png=output.getvalue(),
        width=image.width,
        height=image.height,
        rendered_words=tuple(item[0][0] for item in cloud.layout_),
    )
