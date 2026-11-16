from itertools import count

import pytest

from wordkeep_backend import AnalysisConfig, TextAnalyzer


@pytest.fixture
def analyzer_factory(tmp_path):
    sequence = count()

    def create(*, dictionary=(), stopwords=(), annotator=None, batch_size=32):
        root = tmp_path / str(next(sequence))
        root.mkdir()
        dictionary_path = root / "dict.txt"
        stopwords_path = root / "stopwords.txt"
        dictionary_path.write_text("\n".join(dictionary), encoding="utf-8")
        stopwords_path.write_text("\n".join(stopwords), encoding="utf-8")
        config = AnalysisConfig(
            hanlp_home=root / "hanlp",
            dictionary_path=dictionary_path,
            stopwords_path=stopwords_path,
            batch_size=batch_size,
        )
        return TextAnalyzer(config, annotator=annotator)

    return create
