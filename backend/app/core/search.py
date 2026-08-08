"""Stateless text relevance and hybrid score primitives."""
from collections.abc import Iterable
import re
import unicodedata


AGREEMENT_BONUS_WEIGHT = 0.15


def normalize_text(value: str | None) -> str:
    """Normalize human text for accent- and case-insensitive matching."""
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFKD", value)
    without_accents = "".join(
        character for character in decomposed
        if not unicodedata.combining(character)
    )
    return " ".join(re.findall(r"[a-z0-9]+", without_accents.lower()))


def text_relevance(
    query: str,
    *,
    title: str | None = None,
    summary: str | None = None,
    content: str | None = None,
    tags: Iterable[str] = (),
    project: str | None = None,
) -> float:
    """Return a normalized lexical relevance score in the [0, 1] range."""
    normalized_query = normalize_text(query)
    query_tokens = set(normalized_query.split())
    if not query_tokens:
        return 0.0

    fields = (
        (title, 1.00),
        (summary, 0.80),
        (content, 0.65),
        (" ".join(tags), 0.75),
        (project, 0.50),
    )
    best = 0.0
    for value, weight in fields:
        normalized_value = normalize_text(value)
        if not normalized_value:
            continue

        field_tokens = set(normalized_value.split())
        coverage = len(query_tokens.intersection(field_tokens)) / len(query_tokens)
        if normalized_query == normalized_value:
            field_score = 1.0
        elif normalized_query in normalized_value:
            field_score = max(coverage, 0.90)
        else:
            field_score = coverage
        best = max(best, field_score * weight)

    return round(min(max(best, 0.0), 1.0), 6)


def hybrid_score(semantic_score: float, text_score: float) -> tuple[float, float]:
    """Combine both signals while preserving a strong result from either side."""
    semantic = min(max(semantic_score, 0.0), 1.0)
    text = min(max(text_score, 0.0), 1.0)
    agreement_bonus = min(semantic, text) * AGREEMENT_BONUS_WEIGHT
    combined = min(max(semantic, text) + agreement_bonus, 1.0)
    return round(combined, 6), round(agreement_bonus, 6)
