"""
schemas/search.py — Pydantic schemas for search.

Separate from MemoryResponse on purpose:
  - SearchResult always has a score
  - Future: score breakdown (semantic_score, recency_score, frequency_score)
"""
from typing import Literal

from pydantic import BaseModel, Field
from app.schemas.memory import MemoryResponse


class ScoreBreakdown(BaseModel):
    semantic: float = Field(ge=0.0, le=1.0)
    text: float = Field(ge=0.0, le=1.0)
    agreement_bonus: float = Field(ge=0.0, le=1.0)


class SearchResult(BaseModel):
    memory_id: str
    score: float
    memory: MemoryResponse
    search_type: Literal["semantic", "text", "hybrid"] = "semantic"
    score_breakdown: ScoreBreakdown = Field(
        default_factory=lambda: ScoreBreakdown(
            semantic=0.0,
            text=0.0,
            agreement_bonus=0.0,
        )
    )


class SearchRequest(BaseModel):
    q: str
    limit: int = 10
    mode: Literal["semantic", "text", "hybrid"] = "hybrid"
    type: str | None = None
    project: str | None = None
    tags: list[str] = Field(default_factory=list)
