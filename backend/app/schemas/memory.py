"""
schemas/memory.py — Pydantic schemas for MemoryObject API.

Separado do modelo ORM intencionalmente:
  - MemoryCreate  → o que a API aceita
  - MemoryUpdate  → campos opcionais para PUT
  - MemoryResponse → o que a API retorna

Regra: schemas não importam nada de services/ ou storage/.
"""
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class MemoryCreate(BaseModel):
    type: str = Field(default="memory", description="Tipo do objeto (memory, idea, task, decision...)")
    title: str = Field(..., min_length=1, max_length=500)
    summary: str | None = Field(default=None)
    content: str | None = Field(default=None, description="Conteúdo em Markdown")
    project: str | None = Field(default=None)
    tags: list[str] = Field(default_factory=list)
    relations: list[str] = Field(default_factory=list, description="IDs de MemoryObjects relacionados")
    context: dict = Field(
        default_factory=dict,
        description="Contexto de captura: source, device, location, agent, etc.",
        examples=[{"source": "api"}, {"source": "whatsapp", "created_by": "Hermes"}],
    )

    @model_validator(mode="after")
    def ensure_source_in_context(self) -> "MemoryCreate":
        """Garante que context sempre tem um source. Default: 'api'."""
        if "source" not in self.context:
            self.context["source"] = "api"
        return self


class MemoryUpdate(BaseModel):
    title: str | None = None
    summary: str | None = None
    content: str | None = None
    project: str | None = None
    tags: list[str] | None = None
    relations: list[str] | None = None
    context: dict | None = None


class MemoryResponse(BaseModel):
    id: str
    type: str
    title: str
    summary: str | None
    content: str | None
    project: str | None
    tags: list[str]
    relations: list[str]
    context: dict
    markdown_path: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
