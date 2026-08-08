"""
models/memory.py — MemoryObject

The universal memory unit of Arkan Vault.

Everything is a MemoryObject — conversations, decisions, tasks, ideas,
documents, people, projects. Only the `type` field changes.

ID format: mem_{uuid4_hex}  → e.g. mem_3fa6d1c2a8b04e1f9d7c2e5a1b3f8d9e
  - Prefixed for readability and debuggability
  - UUID hex ensures uniqueness across devices (no sync conflicts)
  - Never use auto-increment integers
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    """Generate a prefixed UUID: mem_<uuid4_hex>"""
    return f"mem_{uuid.uuid4().hex}"


class MemoryObject(Base):
    """
    Universal memory unit. Everything is a MemoryObject.

    Built-in types (extensible via `type` — no migration needed):
        memory        → General memory / note
        conversation  → AI or human conversation
        decision      → A decision made
        task          → A task or action item
        idea          → An idea or hypothesis
        document      → A reference document
        person        → A person or contact
        project       → A project or initiative

    Fields designed to answer future questions like:
        "What did I record while working from home?"
        "Show ideas captured via voice by Hermes."
    """

    __tablename__ = "memory_objects"

    # ── Identity ──────────────────────────────────────────────
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    type: Mapped[str] = mapped_column(String, nullable=False, index=True)

    # ── Content ───────────────────────────────────────────────
    title: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)  # Raw markdown

    # ── Classification ────────────────────────────────────────
    project: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # ── Relations ─────────────────────────────────────────────
    # List of MemoryObject ids this memory relates to
    relations: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # ── Context ───────────────────────────────────────────────
    # Capture HOW and WHERE the memory was created.
    # Enables future queries like "ideas I had via voice" or "at the gym".
    # Examples:
    #   {"source": "voice", "created_by": "Hermes", "location": "Home",
    #    "device": "Notebook", "language": "pt-BR", "agent_session": "..."}
    context: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # ── Storage refs ──────────────────────────────────────────
    # Path to the .md file in data/memories/
    markdown_path: Mapped[str | None] = mapped_column(String, nullable=True)

    # ── Timestamps ────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )

    def __repr__(self) -> str:
        return f"<MemoryObject id={self.id!r} type={self.type!r} title={self.title!r}>"
