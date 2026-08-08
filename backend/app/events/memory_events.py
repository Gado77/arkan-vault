"""
events/memory_events.py — All memory-related events.

Every MemoryObject lifecycle action emits an event.
Hermes, plugins, and future modules subscribe here — never import services directly.
"""
from dataclasses import dataclass

from app.events.base import BaseEvent


@dataclass
class MemoryCreated(BaseEvent):
    memory_id: str = ""
    type: str = ""
    project: str | None = None
    tags: list = None

    def __post_init__(self):
        if self.tags is None:
            self.tags = []


@dataclass
class MemoryUpdated(BaseEvent):
    memory_id: str = ""
    changed_fields: list = None
    type: str = ""
    project: str | None = None
    tags: list = None

    def __post_init__(self):
        if self.changed_fields is None:
            self.changed_fields = []
        if self.tags is None:
            self.tags = []


@dataclass
class MemoryDeleted(BaseEvent):
    memory_id: str = ""


@dataclass
class SearchExecuted(BaseEvent):
    query: str = ""
    result_count: int = 0
    search_type: str = "semantic"  # "semantic" | "text" | "hybrid"


@dataclass
class EmbeddingGenerated(BaseEvent):
    memory_id: str = ""
    model: str = ""


@dataclass
class TagsNormalized(BaseEvent):
    memory_id: str = ""
    original: list = None
    normalized: list = None

    def __post_init__(self):
        if self.original is None:
            self.original = []
        if self.normalized is None:
            self.normalized = []
