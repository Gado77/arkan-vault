"""
workers/knowledge_pipeline.py

The Knowledge Pipeline (formerly EmbeddingWorker).
Listens to events on the EventBus and enriches knowledge.
Currently generates embeddings, but will grow to do summaries, entities, etc.
"""
from app.core import embeddings
from app.events import bus
from app.events.memory_events import (
    EmbeddingGenerated,
    MemoryCreated,
    MemoryDeleted,
    MemoryUpdated,
)
from app.storage.chroma_storage import ChromaVectorStorage
from app.storage.markdown_storage import FilesystemMarkdownStorage
from app.config import settings


_started = False


def start_knowledge_pipeline():
    """Starts the pipeline and registers event listeners."""
    global _started
    if _started:
        return
    
    # Initialize storages needed by the pipeline
    vector_storage = ChromaVectorStorage()
    markdown_storage = FilesystemMarkdownStorage(settings.MEMORIES_PATH)

    def enrich(event: MemoryCreated | MemoryUpdated):
        content = markdown_storage.get(event.memory_id)
        if not content:
            vector_storage.delete(event.memory_id)
            return

        emb = embeddings.embed(content)
        metadata = {
            "type": event.type,
            "project": event.project or ""
        }
        if event.tags:
            metadata["tags"] = ",".join(event.tags)

        vector_storage.save(event.memory_id, emb, metadata)
        bus.publish(EmbeddingGenerated(
            memory_id=event.memory_id,
            model=settings.EMBEDDING_MODEL,
        ))
        print(f"[Knowledge Pipeline] Enriched memory {event.memory_id} with embedding.")

    def on_memory_created(event: MemoryCreated):
        enrich(event)

    def on_memory_updated(event: MemoryUpdated):
        if {"content", "project", "tags"}.intersection(event.changed_fields):
            enrich(event)

    def on_memory_deleted(event: MemoryDeleted):
        vector_storage.delete(event.memory_id)

    bus.subscribe(MemoryCreated, on_memory_created)
    bus.subscribe(MemoryUpdated, on_memory_updated)
    bus.subscribe(MemoryDeleted, on_memory_deleted)
    _started = True
