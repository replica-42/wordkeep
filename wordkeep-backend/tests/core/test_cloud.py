"""Public rendering contracts using actual fonts, masks and PNG output."""

import json
import os
import shutil
import subprocess
import sys
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from types import MappingProxyType

import numpy as np
import pytest
from PIL import Image, ImageDraw
from wordcloud import WordCloud
from wordcloud.wordcloud import FONT_PATH

from wordkeep_backend import (
    WordCloudConfig,
    generate_wordcloud,
    list_colormaps,
    list_system_fonts,
)


@pytest.fixture
def font_path(tmp_path):
    target = tmp_path / "字体 Resources" / "custom.ttf"
    target.parent.mkdir()
    shutil.copyfile(FONT_PATH, target)
    return target


@pytest.fixture
def config(font_path):
    return WordCloudConfig(font_path, width=640, height=360)


def encode(image):
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def test_supplied_terms_survive_and_render_horizontally_on_white(config, monkeypatch):
    rendered = []
    original = WordCloud.to_image

    def capture(cloud):
        rendered.append(cloud)
        return original(cloud)

    monkeypatch.setattr(WordCloud, "to_image", capture)
    frequencies = MappingProxyType({"the": 8, "C++": 5, "iPad Pro": 2, "rare": 1})
    result = generate_wordcloud(frequencies, config)
    assert result.png.startswith(b"\x89PNG\r\n\x1a\n")
    assert result.rendered_words == ("the", "C++", "iPad Pro", "rare")
    assert dict(frequencies) == {"the": 8, "C++": 5, "iPad Pro": 2, "rare": 1}
    cloud = rendered[0]
    assert all(item[3] is None for item in cloud.layout_)
    assert cloud.words_ == {word: count / 8 for word, count in frequencies.items()}
    with Image.open(BytesIO(result.png)) as image:
        assert image.size == (result.width, result.height) == (640, 360)
        assert image.mode == "RGB"
        assert image.getpixel((0, 0)) == (255, 255, 255)
        assert np.any(np.asarray(image) != 255)


def test_default_dimensions_and_font_sizes_follow_the_library(font_path, monkeypatch):
    seen = []
    original = WordCloud.to_image

    def capture(cloud):
        seen.append(cloud)
        return original(cloud)

    monkeypatch.setattr(WordCloud, "to_image", capture)
    result = generate_wordcloud({"coffee": 3}, WordCloudConfig(font_path))
    assert (result.width, result.height) == (1920, 1080)
    assert seen[0].min_font_size == WordCloud().min_font_size
    assert seen[0].max_font_size is None


@pytest.mark.parametrize("scale", [1, 1.0, 1.5, 2])
def test_scale_controls_export_dimensions(config, scale):
    frequencies = {f"word{i:03}": 1 for i in range(400)}
    result = generate_wordcloud(frequencies, replace(config, scale=scale))
    assert result.rendered_words
    assert (result.width, result.height) == (int(640 * scale), int(360 * scale))
    with Image.open(BytesIO(result.png)) as image:
        assert image.size == (result.width, result.height)


@pytest.mark.parametrize("mode", ["RGB", "L", "RGBA", "P"])
def test_mask_bytes_set_dimensions_and_exclude_white_or_transparent_pixels(
    config, mode
):
    transparent = mode in ("RGBA", "P")
    mask = Image.new("RGBA", (360, 180), (0, 0, 0, 0) if transparent else "white")
    ImageDraw.Draw(mask).rectangle((100, 20, 339, 159), fill="black")
    mask = mask.convert(mode)
    result = generate_wordcloud(
        {"coffee": 4, "library": 3}, replace(config, scale=2), mask=encode(mask)
    )
    assert (result.width, result.height) == (720, 360)
    with Image.open(BytesIO(result.png)) as image:
        pixels = np.asarray(image)
        assert np.all(pixels[:, :200] == 255)
        assert np.all(pixels[:40] == 255)
        assert np.all(pixels[320:] == 255)
        assert np.any(pixels[40:320, 200:680] != 255)


def test_max_words_uses_counts_and_a_stable_tie_order(config):
    result = generate_wordcloud(
        {"zebra": 3, "alpha": 3, "coffee": 10}, replace(config, max_words=2)
    )
    assert result.rendered_words == ("coffee", "alpha")


def test_result_reports_only_words_that_fit(config):
    frequencies = {f"word{i:03}": 1 for i in range(400)}
    result = generate_wordcloud(frequencies, replace(config, width=160, height=80))
    assert 0 < len(result.rendered_words) < len(frequencies)
    assert len(set(result.rendered_words)) == len(result.rendered_words)
    assert set(result.rendered_words) <= frequencies.keys()


@pytest.mark.parametrize(
    "frequencies",
    [
        {},
        {"": 1},
        {"  ": 1},
        {1: 1},
        {"coffee": 0},
        {"coffee": -1},
        {"coffee": True},
        {"coffee": 1.5},
        {"coffee": "2"},
    ],
)
def test_invalid_frequencies_are_rejected(config, frequencies):
    with pytest.raises(ValueError):
        generate_wordcloud(frequencies, config)


def test_unusable_resources_fail_instead_of_returning_blank_images(config, tmp_path):
    with pytest.raises(FileNotFoundError, match="missing.ttf"):
        generate_wordcloud(
            {"coffee": 1}, replace(config, font_path=tmp_path / "missing.ttf")
        )
    broken = tmp_path / "broken.ttf"
    broken.write_bytes(b"not a font")
    with pytest.raises(OSError):
        generate_wordcloud({"coffee": 1}, replace(config, font_path=broken))
    with pytest.raises(OSError):
        generate_wordcloud({"coffee": 1}, config, mask=b"not an image")
    with pytest.raises(TypeError, match="image bytes"):
        generate_wordcloud({"coffee": 1}, config, mask=tmp_path / "mask.png")
    with pytest.raises(ValueError):
        generate_wordcloud(
            {"coffee": 1}, config, mask=encode(Image.new("RGB", (100, 100), "white"))
        )
    with pytest.raises(ValueError):
        generate_wordcloud({"coffee": 1}, replace(config, width=1, height=1))


def test_colormap_choices_are_validated(config):
    choices = list_colormaps()
    assert "ocean" in choices and "viridis" in choices
    assert choices == tuple(sorted(set(choices)))
    result = generate_wordcloud({"coffee": 2}, replace(config, colormap="viridis"))
    assert result.rendered_words == ("coffee",)
    with pytest.raises(ValueError, match="unknown colormap"):
        generate_wordcloud({"coffee": 2}, replace(config, colormap="not-a-colormap"))


def test_system_font_choices_resolve_to_usable_paths(
    config, monkeypatch, tmp_path, caplog
):
    import matplotlib.font_manager

    broken = tmp_path / "unusable.ttf"
    broken.write_bytes(b"not a font")
    monkeypatch.setattr(
        matplotlib.font_manager,
        "findSystemFonts",
        lambda: [str(config.font_path), str(config.font_path), str(broken)],
    )
    fonts = list_system_fonts()
    assert len(fonts) == 1
    assert fonts[0].name
    assert fonts[0].path == config.font_path
    assert "Cannot open system font" in caplog.text
    result = generate_wordcloud({"coffee": 2}, replace(config, font_path=fonts[0].path))
    assert result.rendered_words == ("coffee",)


def test_installed_editable_package_renders_outside_the_project_without_hanlp(
    config, tmp_path
):
    environment = os.environ.copy()
    environment.pop("PYTHONPATH", None)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    script = """
import json
import sys
from importlib.metadata import distribution
from pathlib import Path
from wordkeep_backend import WordCloudConfig, generate_wordcloud
assert "hanlp" not in sys.modules
assert "matplotlib" not in sys.modules
config = WordCloudConfig(Path(sys.argv[1]), width=320, height=180, scale=2)
result = generate_wordcloud({"coffee": 5, "library": 2}, config)
assert "hanlp" not in sys.modules
editable = json.loads(distribution("wordkeep-backend").read_text("direct_url.json"))
assert editable["dir_info"]["editable"] is True
print(json.dumps([result.width, result.height, result.rendered_words]))
"""
    completed = subprocess.run(
        [sys.executable, "-c", script, str(config.font_path)],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    assert json.loads(completed.stdout) == [640, 360, ["coffee", "library"]]


def test_frontend_supplies_selected_font_to_application_defaults(
    font_path, app_config_path
):
    settings = json.loads(app_config_path.read_text(encoding="utf-8"))["wordcloud"]
    assert "font_path" not in settings
    config = WordCloudConfig.from_mapping(
        {**settings, "font_path": str(font_path)}, base_dir=app_config_path.parent
    )
    result = generate_wordcloud({"coffee": 3}, config)
    assert config.font_path == font_path
    assert result.rendered_words == ("coffee",)
    assert (result.width, result.height) == (1920, 1080)


def test_wordcloud_writes_png(tmp_path: Path) -> None:
    output = tmp_path / "cloud.png"
    cloud = WordCloud(width=160, height=100, random_state=0)
    cloud.generate_from_frequencies({"hello": 3, "world": 2})
    cloud.to_file(str(output))

    assert output.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
