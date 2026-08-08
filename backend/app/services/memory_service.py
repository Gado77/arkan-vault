"""
services/memory_service.py — MemoryService

A ÚNICA porta de entrada para criação e manipulação de memórias.

Toda criação de memória — via API, Hermes, WhatsApp, importação, plugin —
passa obrigatoriamente por aqui. Nunca direto no storage ou na rota.

Responsabilidades:
    1. Normalizar tags
    2. Gerar mem_{uuid} ID
    3. Garantir context.source preenchido
    4. Preencher timestamps automaticamente
    5. Salvar metadados no SQLite (via MetadataStorage)
    6. Salvar conteúdo no Markdown (via MarkdownStorage)
    7. Publicar MemoryCreated no EventBus
       → EmbeddingWorker escuta e gera embedding de forma desacoplada (Etapa 3)
    8. Retornar MemoryObject criado

Regra: sem lógica HTTP aqui. Sem import de FastAPI.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.core import tags as tag_utils
from app.events import bus
from app.events.memory_events import MemoryCreated, MemoryDeleted, MemoryUpdated
from app.models.memory import MemoryObject, _new_id
from app.schemas.memory import MemoryCreate, MemoryUpdate
from app.storage.markdown_storage import MarkdownStorageBase
from app.storage.metadata_storage import MetadataStorageBase


class MemoryService:
    def __init__(
        self,
        metadata: MetadataStorageBase,
        markdown: MarkdownStorageBase,
    ):
        self.metadata = metadata
        self.markdown = markdown

    # ── Create ────────────────────────────────────────────────────────────────

    def create(self, data: MemoryCreate) -> MemoryObject:
        now = datetime.now(timezone.utc)

        # 1. Normalize tags
        tags = tag_utils.normalize_list(data.tags)

        # 2. Garantir source no context (schema já faz, mas double-check)
        context = {"source": "api", **data.context}

        # 3. Construir objeto
        obj = MemoryObject(
            id=_new_id(),
            type=data.type,
            title=data.title,
            summary=data.summary,
            content=data.content,
            project=data.project,
            tags=tags,
            relations=data.relations or [],
            context=context,
            created_at=now,
            updated_at=now,
        )

        # 4. Salvar metadados no SQLite
        self.metadata.save(obj)

        # 5. Salvar markdown (se houver conteúdo)
        if data.content:
            path = self.markdown.save(obj.id, data.content)
            self.metadata.update(obj.id, {"markdown_path": path})
            obj.markdown_path = path

        # 6. Publicar evento
        #    EmbeddingWorker escutará MemoryCreated e gerará o embedding
        #    de forma desacoplada na Etapa 3 — o POST responde imediatamente.
        bus.publish(MemoryCreated(
            memory_id=obj.id,
            type=obj.type,
            project=obj.project,
            tags=obj.tags,
        ))

        return obj

    # ── Read ──────────────────────────────────────────────────────────────────

    def get(self, id: str) -> MemoryObject | None:
        return self.metadata.get(id)

    def list(
        self,
        type: str | None = None,
        project: str | None = None,
        tags: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[MemoryObject]:
        return self.metadata.list(
            type=type,
            project=project,
            tags=tags,
            limit=limit,
            offset=offset,
        )

    # ── Update ────────────────────────────────────────────────────────────────

    def update(self, id: str, data: MemoryUpdate) -> MemoryObject | None:
        obj_before = self.metadata.get(id)
        if obj_before is None:
            return None

        updates: dict = {}
        old_content = obj_before.content
        markdown_updated = False

        if data.title is not None:
            updates["title"] = data.title
        if data.summary is not None:
            updates["summary"] = data.summary
        if data.content is not None:
            updates["content"] = data.content
            self.markdown.save(id, data.content)
            markdown_updated = True
        if data.project is not None:
            updates["project"] = data.project
        if data.tags is not None:
            updates["tags"] = tag_utils.normalize_list(data.tags)
        if data.relations is not None:
            updates["relations"] = data.relations
        if data.context is not None:
            updates["context"] = data.context

        if not updates:
            return obj_before

        try:
            obj = self.metadata.update(id, updates)
        except Exception as e:
            if markdown_updated:
                if old_content is not None:
                    self.markdown.save(id, old_content)
                else:
                    self.markdown.delete(id)
            raise e

        if obj:
            bus.publish(MemoryUpdated(
                memory_id=id,
                changed_fields=list(updates.keys()),
                type=obj.type,
                project=obj.project,
                tags=obj.tags,
            ))

        return obj

    # ── Delete ────────────────────────────────────────────────────────────────

    def delete(self, id: str) -> bool:
        obj_before = self.metadata.get(id)
        if not obj_before:
            return False

        old_content = obj_before.content
        markdown_deleted = False

        if old_content is not None:
            self.markdown.delete(id)
            markdown_deleted = True

        try:
            deleted = self.metadata.delete(id)
        except Exception as e:
            if markdown_deleted:
                self.markdown.save(id, old_content)
            raise e

        if deleted:
            bus.publish(MemoryDeleted(memory_id=id))

        return deleted
