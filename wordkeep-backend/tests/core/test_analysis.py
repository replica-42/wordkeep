"""Deterministic span and counting contracts."""

from collections.abc import Sequence

import pytest

from wordkeep_backend import Post
from wordkeep_backend.core.analysis import AnnotatedSentence, Entity, Token


class StubAnnotator:
    def __init__(self, *sentences):
        self.sentences = {sentence.text: sentence for sentence in sentences}
        self.calls = []

    def annotate(self, sentences: Sequence[str], dictionary: frozenset[str]):
        self.calls.append((list(sentences), dictionary))
        return [self.sentences[text] for text in sentences]


def annotation(words, tags, entities=(), text=None):
    return AnnotatedSentence(
        text or "".join(words),
        tuple((Token(w, t) for w, t in zip(words, tags, strict=True))),
        tuple(entities),
    )


def analyze(analyzer_factory, sentence, *, repeats=2, **kwargs):
    return analyzer_factory(annotator=StubAnnotator(sentence), **kwargs).analyze(
        [Post(str(i), sentence.text) for i in range(repeats)]
    )


@pytest.mark.parametrize(
    ("word", "pos"),
    [
        ("咖啡", "NN"),
        ("南极", "NR"),
        ("潜水", "VV"),
        ("惬意", "VA"),
        ("宁静", "JJ"),
        ("Python", "FW"),
        ("怅惘", "VA"),
        ("满足", "VV"),
        ("理解", "VV"),
        ("忘记", "VV"),
        ("看一看", "VV"),
        ("试试看", "VV"),
    ],
)
def test_content_and_feelings_need_no_lexical_or_degree_allowlist(
    analyzer_factory, word, pos
):
    sentence = annotation([word], [pos])
    assert analyze(analyzer_factory, sentence, stopwords=[]).frequencies == {word: 2}
    assert analyze(analyzer_factory, sentence, stopwords=[word]).frequencies == {}
    assert analyze(
        analyzer_factory, sentence, repeats=1, stopwords=[word], dictionary=[word]
    ).frequencies == {word: 1}


def test_function_words_are_excluded_but_personal_dictionary_has_final_say(
    analyzer_factory,
):
    sentence = annotation(["非常", "因为", "今天", "三个"], ["AD", "CS", "NT", "CD"])
    assert analyze(analyzer_factory, sentence, stopwords=[]).frequencies == {}
    assert analyze(
        analyzer_factory, sentence, repeats=1, dictionary=["今天"], stopwords=["今天"]
    ).frequencies == {"今天": 1}


def test_dictionary_bypasses_length_and_frequency_filters(analyzer_factory):
    sentence = annotation(["爱", "累", "猫", "咖啡"], ["VV", "VA", "NN", "NN"])
    assert analyze(analyzer_factory, sentence, stopwords=[]).frequencies == {"咖啡": 2}
    assert (
        analyze(analyzer_factory, sentence, repeats=1, stopwords=[]).frequencies == {}
    )
    assert analyze(
        analyzer_factory, sentence, repeats=1, dictionary=["爱", "累", "猫"]
    ).frequencies == {"爱": 1, "猫": 1, "累": 1}


def test_whole_stopword_phrases_consume_fragments_without_harming_other_topics(
    analyzer_factory,
):
    sentence = annotation(["网页", "链接", "网页", "设计"], ["NN"] * 4)
    annotator = StubAnnotator(sentence)
    result = analyzer_factory(stopwords=["网页链接"], annotator=annotator).analyze(
        [Post("1", sentence.text), Post("2", sentence.text)]
    )
    assert result.frequencies == {"网页": 2, "设计": 2}
    assert annotator.calls[0][1] == {"网页链接"}


def test_stopwords_match_whole_terms_not_substrings_or_derived_verb_forms(
    analyzer_factory,
):
    sentence = annotation(["游戏", "游戏机", "看", "看完"], ["NN", "NN", "VV", "VV"])
    assert analyze(
        analyzer_factory, sentence, stopwords=["游戏", "看"]
    ).frequencies == {"游戏机": 2, "看完": 2}


def test_longest_dictionary_entry_protects_nested_parts_and_names_with_spaces(
    analyzer_factory,
):
    sentence = annotation(
        ["再见", "菈菈", "菈菈", "iPad", "Pro"],
        ["VV", "NR", "NR", "FW", "FW"],
        [Entity("菈菈", "PERSON", 1, 2)],
    )
    result = analyze(
        analyzer_factory,
        sentence,
        repeats=1,
        dictionary=["再见菈菈", "菈菈", "iPad Pro"],
        stopwords=["再见菈菈"],
    )
    assert result.frequencies == {"iPad Pro": 1, "再见菈菈": 1, "菈菈": 1}
    assert all(term.sources == {"dictionary"} for term in result.terms)


def test_entity_replaces_components_without_bypassing_stopwords_or_frequency(
    analyzer_factory,
):
    sentence = annotation(
        ["喜欢", "你"], ["VV", "PN"], [Entity("喜欢你", "WORK_OF_ART", 0, 2)]
    )
    assert analyze(analyzer_factory, sentence, stopwords=["喜欢"]).frequencies == {
        "喜欢你": 2
    }
    assert analyze(analyzer_factory, sentence, stopwords=["喜欢你"]).frequencies == {}
    assert (
        analyze(analyzer_factory, sentence, repeats=1, stopwords=[]).frequencies == {}
    )


def test_personal_entry_precedes_an_overlapping_entity(analyzer_factory):
    sentence = annotation(
        ["星光", "灿烂", "夜"],
        ["NN", "VA", "NN"],
        [Entity("灿烂夜", "WORK_OF_ART", 1, 3)],
    )
    assert analyze(
        analyzer_factory, sentence, repeats=1, dictionary=["星光灿烂"], stopwords=[]
    ).frequencies == {"星光灿烂": 1}


def test_longest_entity_wins_over_nested_entities_and_count_is_not_duplicated(
    analyzer_factory,
):
    sentence = annotation(
        ["上海", "博物馆"],
        ["NR", "NN"],
        [Entity("上海", "GPE", 0, 1), Entity("上海博物馆", "ORG", 0, 2)],
    )
    assert analyze(analyzer_factory, sentence, stopwords=[]).frequencies == {
        "上海博物馆": 2
    }


def test_time_numbers_and_symbol_entities_do_not_gain_special_protection(
    analyzer_factory,
):
    sentence = annotation(
        ["今天", "1999", "¥¥", "爱"],
        ["NT", "CD", "PU", "VV"],
        [
            Entity("今天", "DATE", 0, 1),
            Entity("1999", "DATE", 1, 2),
            Entity("¥¥", "PRODUCT", 2, 3),
            Entity("爱", "PERSON", 3, 4),
        ],
    )
    assert analyze(analyzer_factory, sentence, stopwords=[]).frequencies == {}
    assert analyze(
        analyzer_factory, sentence, repeats=1, dictionary=["1999"]
    ).frequencies == {"1999": 1}


def test_complete_feelings_use_the_same_dictionary_rule_as_other_phrases(
    analyzer_factory,
):
    sentence = annotation(
        ["不", "喜欢", "笑", "死", "累", "坏"], ["AD", "VV", "VV", "VV", "VA", "VA"]
    )
    dictionary = ["不喜欢", "笑死", "累坏"]
    assert analyze(
        analyzer_factory,
        sentence,
        repeats=1,
        dictionary=dictionary,
        stopwords=["喜欢", "死"],
    ).frequencies == {"不喜欢": 1, "笑死": 1, "累坏": 1}


def test_no_automatic_negation_or_nominal_compound_invention(analyzer_factory):
    sentence = annotation(["不", "喜欢", "咖啡", "豆"], ["AD", "VV", "NN", "NN"])
    assert analyze(analyzer_factory, sentence, stopwords=[]).frequencies == {
        "咖啡": 2,
        "喜欢": 2,
    }


def test_counts_are_total_occurrences_and_not_document_weights(analyzer_factory):
    sentence = annotation(["咖啡", "咖啡", "烘焙"], ["NN", "NN", "VV"])
    result = analyze(analyzer_factory, sentence, stopwords=[])
    assert result.frequencies == {"咖啡": 4, "烘焙": 2}
    assert result.terms[0].document_count == 2
    assert result.terms[0].examples == (sentence.text,)


def test_frequencies_include_all_retained_terms(analyzer_factory):
    words = [f"词语{i}" for i in range(420)] + ["怅惘"]
    result = analyze(
        analyzer_factory, annotation(words, ["NN"] * 420 + ["VA"]), stopwords=[]
    )
    assert len(result.frequencies) == 421
    assert all(count == 2 for count in result.frequencies.values())


@pytest.mark.parametrize("word", ["C++", "C#", "Sea-Bed", "v1.2", "O'Connor", "たきな"])
def test_boundary_cleanup_keeps_internal_name_symbols(analyzer_factory, word):
    assert analyze(
        analyzer_factory, annotation([f"「{word}」"], ["FW"]), stopwords=[]
    ).frequencies == {word: 2}


def test_boundary_cleanup_precedes_dictionary_lookup(analyzer_factory):
    assert analyze(
        analyzer_factory, annotation(["（侑）"], ["NR"]), repeats=1, dictionary=["侑"]
    ).frequencies == {"侑": 1}


def test_html_and_url_cleaning_respects_sentence_boundaries(analyzer_factory):
    annotator = StubAnnotator(
        annotation(["咖啡", "。"], ["NN", "PU"]),
        annotation(["烘焙", "！"], ["VV", "PU"]),
    )
    result = analyzer_factory(dictionary=["咖啡", "烘焙"], annotator=annotator).analyze(
        [Post("1", "<b>咖啡。</b>\nhttps://t.cn/abc烘焙！")]
    )
    assert result.frequencies == {"咖啡": 1, "烘焙": 1}
    assert result.sentence_count == 2


def test_analyzer_reuse_does_not_carry_counts_between_runs(analyzer_factory):
    sentence = annotation(["咖啡"], ["NN"])
    analyzer = analyzer_factory(stopwords=[], annotator=StubAnnotator(sentence))
    assert analyzer.analyze([Post("1", "咖啡")]).frequencies == {}
    assert analyzer.analyze([Post("2", "咖啡")]).frequencies == {}


def test_invalid_inputs_and_annotations_abort(analyzer_factory):
    analyzer = analyzer_factory(annotator=StubAnnotator())
    with pytest.raises(ValueError, match="duplicate"):
        analyzer.analyze([Post("1", ""), Post("1", "")])
    with pytest.raises(ValueError, match="post id"):
        analyzer.analyze([Post("", "猫")])
    with pytest.raises(ValueError, match="text must"):
        analyzer.analyze([Post("1", None)])
    with pytest.raises(ValueError, match="entity span"):
        annotation(["猫"], ["NN"], [Entity("猫", "PERSON", 0, 2)])
    with pytest.raises(ValueError, match="batch_size"):
        analyzer_factory(batch_size=0)
    with pytest.raises(ValueError, match="ambiguous"):
        analyzer_factory(dictionary=["iPad Pro", "iPadPro"])


@pytest.mark.parametrize("mode", ["count", "order"])
def test_annotation_alignment_errors_abort(analyzer_factory, mode):

    class InvalidAnnotator:
        def annotate(self, sentences, dictionary):
            return [] if mode == "count" else [annotation(["错误"], ["NN"])]

    with pytest.raises(ValueError, match="annotation"):
        analyzer_factory(annotator=InvalidAnnotator()).analyze([Post("1", "咖啡")])


def test_empty_input_needs_no_model(analyzer_factory, monkeypatch):
    monkeypatch.delenv("HANLP_HOME", raising=False)
    assert analyzer_factory().analyze([]).frequencies == {}
    assert analyzer_factory().analyze([Post("1", " ")]).post_count == 1


def test_dictionary_never_extracts_a_name_inside_another_complete_word(
    analyzer_factory,
):
    sentence = annotation(["白桃香", "可爱", "艾莉西娅"], ["NN", "VA", "NR"])
    assert analyze(
        analyzer_factory, sentence, dictionary=["桃香", "爱", "艾莉"], stopwords=[]
    ).frequencies == {"可爱": 2, "白桃香": 2, "艾莉西娅": 2}


def test_dictionary_recovers_a_feeling_with_inconsistent_model_tags(analyzer_factory):
    one = annotation(["难过"], ["VA"], text="难过。")
    two = annotation(["难过"], ["AD"], text="难过！")
    annotator = StubAnnotator(one, two)
    posts = [Post("1", one.text), Post("2", two.text)]
    assert (
        analyzer_factory(stopwords=[], annotator=annotator).analyze(posts).frequencies
        == {}
    )
    assert analyzer_factory(
        dictionary=["难过"], stopwords=[], annotator=annotator
    ).analyze(posts).frequencies == {"难过": 2}


def test_dictionary_recovers_numeric_names_without_promoting_all_numbers(
    analyzer_factory,
):
    sentence = annotation(["084", "1999", "2026"], ["NT", "CD", "CD"])
    assert analyze(
        analyzer_factory, sentence, repeats=1, dictionary=["084", "1999"], stopwords=[]
    ).frequencies == {"084": 1, "1999": 1}


def test_boundary_normalization_does_not_bypass_an_exact_stopword(analyzer_factory):
    assert (
        analyze(
            analyzer_factory, annotation([".jpg"], ["NN"]), stopwords=[".jpg"]
        ).frequencies
        == {}
    )
    assert analyze(
        analyzer_factory,
        annotation([" \t「 たきな 」\u3000"], ["FW"], text="「 たきな 」"),
        stopwords=[],
    ).frequencies == {"たきな": 2}
