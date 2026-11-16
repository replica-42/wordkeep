"""Configuration crossing the application/Python boundary."""

import json
import math
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from wordkeep_backend import (
    AnalysisConfig,
    TextAnalyzer,
    WordCloudConfig,
    load_config,
    load_wordcloud_config,
)


def settings():
    return {
        "hanlp_home": "data/hanlp",
        "stopwords_path": "data/stopwords.txt",
        "dictionary_path": "data/dict.txt",
        "batch_size": 8,
    }


def test_json_and_received_mapping_resolve_against_the_resource_root(
    tmp_path, monkeypatch
):
    bundle = tmp_path / "应用 Resources"
    bundle.mkdir()
    path = bundle / "config.json"
    path.write_text(json.dumps({"analysis": settings()}), encoding="utf-8")
    elsewhere = tmp_path / "unrelated"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    from_file = load_config(path)
    from_message = AnalysisConfig.from_mapping(
        json.loads(path.read_text())["analysis"], base_dir=bundle
    )
    assert from_file == from_message
    assert from_file.dictionary_path == bundle / "data/dict.txt"
    assert from_file.hanlp_home == bundle / "data/hanlp"
    with pytest.raises(FrozenInstanceError):
        from_file.batch_size = 16


def test_absolute_paths_are_preserved_and_default_batch_size_is_available(tmp_path):
    values = settings()
    values.pop("batch_size")
    values["dictionary_path"] = str(tmp_path / "custom dict.txt")
    config = AnalysisConfig.from_mapping(values, base_dir=tmp_path / "bundle")
    assert config.dictionary_path == tmp_path / "custom dict.txt"
    assert config.batch_size == 32


@pytest.mark.parametrize("batch_size", [0, -1, True, 1.5, "32", None])
def test_invalid_batch_size_is_rejected(tmp_path, batch_size):
    with pytest.raises(ValueError, match="batch_size"):
        AnalysisConfig.from_mapping(
            {**settings(), "batch_size": batch_size}, base_dir=tmp_path
        )


@pytest.mark.parametrize("field", ["hanlp_home", "stopwords_path", "dictionary_path"])
def test_resource_fields_are_required(tmp_path, field):
    values = settings()
    values.pop(field)
    with pytest.raises(ValueError, match=field):
        AnalysisConfig.from_mapping(values, base_dir=tmp_path)


@pytest.mark.parametrize("value", ["", "  ", None, 123, ["data/dict.txt"]])
def test_invalid_resource_paths_are_rejected(tmp_path, value):
    with pytest.raises(ValueError, match="dictionary_path"):
        AnalysisConfig.from_mapping(
            {**settings(), "dictionary_path": value}, base_dir=tmp_path
        )


def test_unknown_settings_and_implicit_working_directory_are_rejected(tmp_path):
    with pytest.raises(ValueError, match="unknown.*batch_szie"):
        AnalysisConfig.from_mapping({**settings(), "batch_szie": 32}, base_dir=tmp_path)
    with pytest.raises(ValueError, match="base_dir"):
        AnalysisConfig.from_mapping(settings(), base_dir=Path("relative"))
    with pytest.raises(ValueError, match="absolute Path"):
        AnalysisConfig(Path("relative"), tmp_path, tmp_path)


@pytest.mark.parametrize(
    "content", ["null", "[]", "{}", '{"analysis": []}', "not json"]
)
def test_invalid_config_files_fail_without_fallback(tmp_path, content):
    path = tmp_path / "config.json"
    path.write_text(content)
    with pytest.raises(ValueError):
        load_config(path)


def test_missing_word_files_fail_without_using_a_bundled_default(tmp_path):
    config = AnalysisConfig.from_mapping(settings(), base_dir=tmp_path)
    with pytest.raises(FileNotFoundError, match="dict.txt"):
        TextAnalyzer(config)
    config.dictionary_path.parent.mkdir(parents=True)
    config.dictionary_path.write_text("")
    with pytest.raises(FileNotFoundError, match="stopwords.txt"):
        TextAnalyzer(config)


def test_empty_word_files_are_valid_and_do_not_load_the_model(tmp_path):
    config = AnalysisConfig.from_mapping(settings(), base_dir=tmp_path)
    config.dictionary_path.parent.mkdir(parents=True)
    config.dictionary_path.write_text("")
    config.stopwords_path.write_text("")
    analyzer = TextAnalyzer(config)
    assert analyzer.dictionary == analyzer.stopwords == frozenset()
    assert analyzer.analyze([]).frequencies == {}


def test_defaults_and_relative_font_paths_are_independent_of_cwd(tmp_path, monkeypatch):
    bundle = tmp_path / "应用 Resources"
    bundle.mkdir()
    monkeypatch.chdir(tmp_path)
    path = bundle / "config.json"
    values = {"font_path": "fonts/custom.ttf"}
    path.write_text(json.dumps({"wordcloud": values}), encoding="utf-8")
    config = load_wordcloud_config(path)
    assert config == WordCloudConfig.from_mapping(values, base_dir=bundle)
    assert config.font_path == bundle / "fonts/custom.ttf"
    assert (config.width, config.height, config.max_words) == (1920, 1080, 400)
    assert config.colormap == "ocean"
    assert config.scale == 1
    with pytest.raises(FrozenInstanceError):
        config.scale = 2


def test_selected_system_font_and_custom_settings_are_preserved(tmp_path):
    values = {
        "font_path": str(tmp_path / "system.ttf"),
        "width": 640,
        "height": 360,
        "max_words": 20,
        "scale": 2.5,
        "colormap": "viridis",
    }
    config = WordCloudConfig.from_mapping(values, base_dir=tmp_path / "elsewhere")
    assert config == WordCloudConfig(
        tmp_path / "system.ttf", 640, 360, 20, "viridis", 2.5
    )


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("width", 0),
        ("height", -1),
        ("max_words", True),
        ("width", 1.5),
        ("height", "1080"),
        ("scale", 0),
        ("scale", -1),
        ("scale", True),
        ("scale", float("nan")),
        ("scale", float("inf")),
        ("scale", "2"),
        ("colormap", None),
        ("colormap", " "),
    ],
)
def test_invalid_settings_fail_for_both_config_entry_points(tmp_path, name, value):
    with pytest.raises(ValueError, match=name):
        WordCloudConfig(tmp_path / "font.ttf", **{name: value})
    with pytest.raises(ValueError, match=name):
        WordCloudConfig.from_mapping(
            {"font_path": "font.ttf", name: value}, base_dir=tmp_path
        )


@pytest.mark.parametrize(
    "field", ["min_font_size", "background_color", "random_seed", "mask_path"]
)
def test_unexposed_settings_are_rejected(tmp_path, field):
    with pytest.raises(ValueError, match="unknown.*" + field):
        WordCloudConfig.from_mapping(
            {"font_path": "font.ttf", field: 1}, base_dir=tmp_path
        )


def test_missing_font_and_implicit_base_directory_are_rejected(tmp_path):
    with pytest.raises(ValueError, match="font_path"):
        WordCloudConfig.from_mapping({}, base_dir=tmp_path)
    with pytest.raises(ValueError, match="font_path"):
        WordCloudConfig.from_mapping({"font_path": " "}, base_dir=tmp_path)
    with pytest.raises(ValueError, match="absolute Path"):
        WordCloudConfig(Path("font.ttf"))
    with pytest.raises(ValueError, match="base_dir"):
        WordCloudConfig.from_mapping(
            {"font_path": "font.ttf"}, base_dir=Path("relative")
        )


@pytest.mark.parametrize(
    "content", ["null", "[]", "{}", '{"wordcloud": []}', "not json"]
)
def test_invalid_rendering_config_file_fails(tmp_path, content):
    path = tmp_path / "config.json"
    path.write_text(content)
    with pytest.raises(ValueError):
        load_wordcloud_config(path)


@pytest.mark.parametrize("scale", [0.0001, 0.1, 0.5, math.nextafter(1, 0)])
def test_scale_below_one_is_rejected_by_constructor_mapping_and_json(tmp_path, scale):
    values = {"font_path": "font.ttf", "scale": scale}
    message = "scale.*greater than or equal to 1"
    with pytest.raises(ValueError, match=message):
        WordCloudConfig(tmp_path / "font.ttf", scale=scale)
    with pytest.raises(ValueError, match=message):
        WordCloudConfig.from_mapping(values, base_dir=tmp_path)
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"wordcloud": values}), encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        load_wordcloud_config(path)
