"""Word-list loading and validation."""

import pytest

from wordkeep_backend import load_config, load_word_list


def test_word_files_accept_bom_but_abort_on_invalid_lines(tmp_path):
    path = tmp_path / "dict.txt"
    path.write_text("\ufeff喜欢\n\n猫\n")
    assert load_word_list(path) == {"喜欢", "猫"}
    path.write_text("喜欢\n坏\x00词\n猫\n")
    with pytest.raises(ValueError, match="entry 2"):
        load_word_list(path)
    path.write_bytes(b"\xff")
    with pytest.raises(UnicodeDecodeError):
        load_word_list(path)


def test_empty_application_wordlists_have_no_preset_personal_opinions(app_config_path):
    config = load_config(app_config_path)
    assert load_word_list(config.stopwords_path) == frozenset()
    assert load_word_list(config.dictionary_path) == frozenset()
