"""Schemas for the interactive memory graph."""
from datetime import datetime

from pydantic import BaseModel, Field


class GraphNode(BaseModel):
    id: str
    type: str
    title: str
    summary: str | None = None
    project: str | None = None
    tags: list[str] = Field(default_factory=list)
    degree: int = 0
    size: float = 1.0
    created_at: datetime
    updated_at: datetime


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    kinds: list[str]
    weight: float = Field(ge=0.0, le=1.0)
    label: str | None = None


class GraphStats(BaseModel):
    nodes: int
    edges: int
    projects: int
    types: int


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    stats: GraphStats
