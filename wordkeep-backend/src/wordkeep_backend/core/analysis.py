"""Coarse words and named entities filtered by two user-owned word lists."""

import html
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Literal, Protocol

from wordkeep_backend.core.config import AnalysisConfig
from wordkeep_backend.core.wordlists import load_word_list

# CTB content-word tags and OntoNotes name categories.
CONTENT_POS = frozenset({"NN", "NR", "VV", "VA", "JJ", "FW"})
ENTITY_TYPES = frozenset(
    {
        "PERSON",
        "ORG",
        "GPE",
        "LOC",
        "FAC",
        "PRODUCT",
        "EVENT",
        "WORK_OF_ART",
        "LAW",
        "LANGUAGE",
        "NORP",
    }
)
BOUNDARY_PUNCTUATION = "，。！？；：、,.!?;:（）()[]{}<>《》〈〉【】「」『』“”‘’\"'"
Source = Literal["dictionary", "entity", "pos"]


def strip_word_boundaries(word: str) -> str:
    start, end = 0, len(word)
    while start < end and (
        word[start].isspace() or word[start] in BOUNDARY_PUNCTUATION
    ):
        start += 1
    while end > start and (
        word[end - 1].isspace() or word[end - 1] in BOUNDARY_PUNCTUATION
    ):
        end -= 1
    return word[start:end]


@dataclass(frozen=True)
class Post:
    id: str
    text: str


@dataclass(frozen=True)
class Token:
    text: str
    pos: str
    start: int | None = None
    end: int | None = None


@dataclass(frozen=True)
class Entity:
    text: str
    label: str
    start: int
    end: int


@dataclass(frozen=True)
class AnnotatedSentence:
    text: str
    tokens: tuple[Token, ...]
    entities: tuple[Entity, ...] = ()

    def __post_init__(self) -> None:
        if any(not token.text for token in self.tokens):
            raise ValueError("annotation contains an empty token")
        for entity in self.entities:
            if not 0 <= entity.start < entity.end <= len(self.tokens):
                raise ValueError(f"invalid entity span: {entity}")


class Annotator(Protocol):
    def annotate(
        self, sentences: Sequence[str], dictionary: frozenset[str]
    ) -> list[AnnotatedSentence]: ...


@dataclass(frozen=True)
class Term:
    text: str
    occurrences: int
    document_count: int
    sources: frozenset[Source]
    examples: tuple[str, ...]


@dataclass(frozen=True)
class AnalysisResult:
    terms: tuple[Term, ...]
    post_count: int
    sentence_count: int

    @property
    def frequencies(self) -> dict[str, int]:
        """All retained words, weighted by actual occurrences."""
        return {term.text: term.occurrences for term in self.terms}


def _sentences(text: str) -> list[str]:
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"https?://[^\s\u4e00-\u9fff<>]+", "\n", text)
    return [s.strip() for s in re.split(r"(?<=[。！？!?])|\n+", text) if s.strip()]


@dataclass(frozen=True)
class _Candidate:
    text: str
    start: int
    end: int
    source: Source


class _Lexicon:
    """Match complete dictionary entries along token boundaries."""

    def __init__(self, words: frozenset[str]) -> None:
        self.words: dict[str, str] = {}
        self.prefixes: set[str] = set()
        for word in sorted(words):
            key = "".join(word.split())
            if key in self.words and self.words[key] != word:
                raise ValueError(f"ambiguous dictionary spacing: {word!r}")
            self.words[key] = word
            self.prefixes.update(key[:i] for i in range(1, len(key) + 1))

    def matches(
        self, tokens: tuple[Token, ...], dictionary: frozenset[str]
    ) -> list[_Candidate]:
        matches = []
        for start in range(len(tokens)):
            joined = ""
            for end in range(start, len(tokens)):
                joined += "".join(tokens[end].text.split())
                if joined not in self.prefixes:
                    break
                if joined in self.words:
                    word = self.words[joined]
                    matches.append(
                        _Candidate(
                            word,
                            start,
                            end + 1,
                            "dictionary" if word in dictionary else "pos",
                        )
                    )
        return matches


def _candidates(
    sentence: AnnotatedSentence,
    lexicon: _Lexicon,
    dictionary: frozenset[str],
    stopwords: frozenset[str],
) -> list[_Candidate]:
    tokens = sentence.tokens
    spans = lexicon.matches(tokens, dictionary)
    spans.extend(
        _Candidate(e.text, e.start, e.end, "entity")
        for e in sentence.entities
        if e.label in ENTITY_TYPES
    )
    # Explicit personal entries first; otherwise choose complete nonoverlapping spans.
    spans.sort(
        key=lambda c: (
            c.source != "dictionary",
            -(c.end - c.start),
            c.source != "entity",
            c.start,
            c.text,
        )
    )
    occupied: set[int] = set()
    selected = []
    spans.extend(_Candidate(t.text, i, i + 1, "pos") for i, t in enumerate(tokens))
    for candidate in spans:
        span = set(range(candidate.start, candidate.end))
        if span & occupied:
            continue
        # Consume every token in the selected span, including excluded spans.
        occupied.update(span)
        word = strip_word_boundaries(candidate.text)
        if not word:
            continue
        if word in dictionary:
            source: Source = "dictionary"
        elif (
            word in stopwords
            or candidate.text in stopwords
            or len(word) < 2
            or not any(char.isalnum() for char in word)
            or (
                candidate.source != "entity"
                and tokens[candidate.start].pos not in CONTENT_POS
            )
        ):
            continue
        else:
            source = candidate.source
        selected.append(_Candidate(word, candidate.start, candidate.end, source))
    return sorted(selected, key=lambda c: c.start)


@dataclass
class _Stats:
    occurrences: int = 0
    posts: set[str] = field(default_factory=set)
    sources: set[Source] = field(default_factory=set)
    examples: list[str] = field(default_factory=list)


class TextAnalyzer:
    """Reusable sequential analyzer; selection preferences live in the word lists."""

    def __init__(
        self,
        config: AnalysisConfig,
        *,
        annotator: Annotator | None = None,
    ) -> None:
        self.config = config
        self.dictionary = load_word_list(config.dictionary_path)
        self.stopwords = load_word_list(config.stopwords_path)
        self._lexicon = _Lexicon(self.dictionary | self.stopwords)
        self._annotator = annotator

    def analyze(self, posts: Iterable[Post]) -> AnalysisResult:
        ids: set[str] = set()
        samples: list[tuple[str, str]] = []
        for post in posts:
            if not isinstance(post.id, str) or not post.id.strip():
                raise ValueError("post id must be nonempty text")
            if not isinstance(post.text, str):
                raise ValueError(f"post {post.id!r}: text must be a string")
            if post.id in ids:
                raise ValueError(f"duplicate post id: {post.id}")
            ids.add(post.id)
            samples.extend((post.id, text) for text in _sentences(post.text))
        if not samples:
            return AnalysisResult((), len(ids), 0)
        if self._annotator is None:
            from wordkeep_backend.core.hanlp_backend import HanLPAnnotator

            self._annotator = HanLPAnnotator(self.config)
        stats: dict[str, _Stats] = {}
        for offset in range(0, len(samples), self.config.batch_size):
            batch = samples[offset : offset + self.config.batch_size]
            annotations = self._annotator.annotate(
                [text for _, text in batch],
                self.dictionary | self.stopwords,
            )
            if len(annotations) != len(batch):
                raise ValueError("annotation count does not match sentence count")
            for (post_id, text), annotation in zip(batch, annotations, strict=True):
                if annotation.text != text:
                    raise ValueError("annotation order does not match input sentences")
                for candidate in _candidates(
                    annotation,
                    self._lexicon,
                    self.dictionary,
                    self.stopwords,
                ):
                    entry = stats.setdefault(candidate.text, _Stats())
                    entry.occurrences += 1
                    entry.posts.add(post_id)
                    entry.sources.add(candidate.source)
                    if text not in entry.examples and len(entry.examples) < 3:
                        entry.examples.append(text)
        terms = tuple(
            Term(
                text,
                entry.occurrences,
                len(entry.posts),
                frozenset(entry.sources),
                tuple(entry.examples),
            )
            for text, entry in sorted(
                stats.items(),
                key=lambda pair: (-pair[1].occurrences, pair[0]),
            )
            if entry.occurrences >= 2 or text in self.dictionary
        )
        return AnalysisResult(terms, len(ids), len(samples))
