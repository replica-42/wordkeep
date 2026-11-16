"""Local Small MTL inference using application-supplied resources."""

import inspect
import os
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from wordkeep_backend.core.analysis import AnnotatedSentence, Entity, Token
from wordkeep_backend.core.config import AnalysisConfig

MODEL_DIRECTORY = "mtl/close_tok_pos_ner_srl_dep_sdp_con_electra_small_20220626_175100"

TRANSFORMER_DIRECTORY = "transformers/electra_zh_small_20210706_125427"
# Files required by the bundled Small model and its tokenizer.
REQUIRED_RESOURCES = (
    *(
        f"{MODEL_DIRECTORY}/{name}"
        for name in (
            "model.pt",
            "config.json",
            "con_vocabs.json",
            "dep_vocabs.json",
            "ner/msra_vocabs.json",
            "ner/ontonotes_vocabs.json",
            "ner/pku_vocabs.json",
            "pos/863_vocabs.json",
            "pos/ctb_vocabs.json",
            "pos/pku_vocabs.json",
            "sdp_vocabs.json",
            "srl_vocabs.json",
            "tok/coarse_vocabs.json",
            "tok/fine_vocabs.json",
        )
    ),
    *(
        f"{TRANSFORMER_DIRECTORY}/{name}"
        for name in (
            "config.json",
            "tokenizer_config.json",
            "vocab.txt",
        )
    ),
    "utils/char_table_20210602_202632.json",
)


class HanLPAnnotator:
    def __init__(self, config: AnalysisConfig) -> None:
        home = config.hanlp_home.resolve()
        model_path = home / MODEL_DIRECTORY
        for name in REQUIRED_RESOURCES:
            if not (home / name).is_file():
                raise FileNotFoundError(f"model resource is missing: {home / name}")
        # HanLP captures this default on import; each worker has one resource root.
        imported_io = sys.modules.get("hanlp.utils.io_util")
        if imported_io is not None:
            captured_home = (
                inspect.signature(imported_io.get_resource)
                .parameters["save_dir"]
                .default
            )
            if Path(captured_home).expanduser().resolve() != home:
                raise RuntimeError(
                    "HanLP is already initialized with another resource directory; "
                    "start a new Python worker with this configuration"
                )
        os.environ["HANLP_HOME"] = str(home)
        import hanlp  # type: ignore[import-untyped]

        self._model: Any = hanlp.load(str(model_path), devices=-1, verbose=False)

    def annotate(
        self, sentences: Sequence[str], dictionary: frozenset[str]
    ) -> list[AnnotatedSentence]:
        if not sentences:
            return []
        self._model["tok/coarse"].config.output_spans = True
        # Merge dictionary and stopword phrases before POS/NER and filtering.
        self._model["tok/coarse"].dict_combine = {
            tuple(word.split()) if len(word.split()) > 1 else word
            for word in dictionary
        }
        document = self._model(
            list(sentences),
            tasks=["tok/coarse", "pos/ctb", "ner/ontonotes"],
            skip_tasks="tok/fine",
        )
        result = []
        for text, tokens, tags, entities in zip(
            sentences,
            document["tok/coarse"],
            document["pos/ctb"],
            document["ner/ontonotes"],
            strict=True,
        ):
            result.append(
                AnnotatedSentence(
                    text,
                    tuple(
                        Token(word[0], tag, word[1], word[2])
                        for word, tag in zip(tokens, tags, strict=True)
                    ),
                    tuple(Entity(*entity) for entity in entities),
                )
            )
        return result
