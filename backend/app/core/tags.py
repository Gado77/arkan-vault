"""
core/tags.py — Tag normalization and utilities.

Responsibility: Parse, normalize, and validate tags.
No knowledge of MemoryObject or any business concept.
"""


def normalize(tag: str) -> str:
    """Lowercase, strip whitespace, replace spaces with hyphens."""
    return tag.strip().lower().replace(" ", "-")


def normalize_list(tags: list[str]) -> list[str]:
    """Normalize and deduplicate a list of tags. Returns sorted list."""
    return sorted(set(normalize(t) for t in tags if t.strip()))
