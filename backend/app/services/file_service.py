"""Business orchestration for binary file memories."""
from pathlib import Path
from typing import BinaryIO

from app.core.file_extraction import extract_text
from app.models.memory import MemoryObject
from app.schemas.memory import MemoryCreate
from app.services.memory_service import MemoryService
from app.storage.file_storage import FileStorageBase
from app.storage.metadata_storage import MetadataStorageBase


class FileService:
    def __init__(self, metadata: MetadataStorageBase, memories: MemoryService, files: FileStorageBase, max_bytes: int, max_extract_bytes: int = 2_000_000, max_extract_chars: int = 20_000):
        self.metadata = metadata
        self.memories = memories
        self.files = files
        self.max_bytes = max_bytes
        self.max_extract_bytes = max_extract_bytes
        self.max_extract_chars = max_extract_chars

    def upload(self, stream: BinaryIO, filename: str, content_type: str | None, project: str | None = None, tags: list[str] | None = None) -> tuple[MemoryObject, bool]:
        safe_name = Path(filename or "arquivo").name or "arquivo"
        stored = self.files.save(stream, self.max_bytes)
        return self._register(stored, safe_name, content_type, project, tags)

    def start_upload(self, filename: str, size_bytes: int, content_type: str | None, project: str | None = None, tags: list[str] | None = None, checksum: str | None = None) -> dict:
        if size_bytes < 0 or size_bytes > self.max_bytes:
            raise ValueError("Declared file size exceeds the upload limit.")
        safe_name = Path(filename or "arquivo").name or "arquivo"
        return self.files.create_upload({
            "filename": safe_name, "size_bytes": size_bytes,
            "content_type": content_type or "application/octet-stream",
            "project": project, "tags": tags or [], "sha256": checksum,
        })

    def upload_status(self, upload_id: str) -> dict | None:
        return self.files.upload_status(upload_id)

    def append_upload(self, upload_id: str, offset: int, data: bytes) -> dict:
        return self.files.append_upload(upload_id, offset, data, self.max_bytes)

    def complete_upload(self, upload_id: str) -> tuple[MemoryObject, bool]:
        stored, session = self.files.finish_upload(upload_id, self.max_bytes)
        return self._register(stored, session["filename"], session.get("content_type"), session.get("project"), session.get("tags"))

    def _register(self, stored, safe_name: str, content_type: str | None, project: str | None, tags: list[str] | None) -> tuple[MemoryObject, bool]:
        existing = self.metadata.find_by_context("sha256", stored.sha256, type="file")
        if existing:
            return existing, True

        mime = content_type or "application/octet-stream"
        size_label = self._size_label(stored.size)
        extracted = extract_text(stored.path, safe_name, mime, max_bytes=self.max_extract_bytes, max_chars=self.max_extract_chars)
        extraction_section = f"\n## Conteúdo extraído\n\n```text\n{extracted}\n```\n" if extracted else ""
        memory = self.memories.create(MemoryCreate(
            type="file",
            title=safe_name,
            summary=f"Arquivo {mime} · {size_label}",
            content=f"# {safe_name}\n\nArquivo armazenado no Arkan Vault.\n\n- Tipo: `{mime}`\n- Tamanho: `{size_label}`\n- SHA-256: `{stored.sha256}`\n{extraction_section}",
            project=project,
            tags=["file", *(tags or [])],
            context={
                "source": "upload",
                "original_filename": safe_name,
                "mime_type": mime,
                "size_bytes": stored.size,
                "sha256": stored.sha256,
                "storage_key": stored.key,
                "text_extracted": bool(extracted),
                "extracted_chars": len(extracted or ""),
            },
        ))
        return memory, not stored.created

    def list(self, limit: int = 200, offset: int = 0) -> list[MemoryObject]:
        return self.metadata.list(type="file", limit=limit, offset=offset)

    def get(self, memory_id: str) -> MemoryObject | None:
        memory = self.metadata.get(memory_id)
        return memory if memory and memory.type == "file" else None

    def download(self, memory_id: str) -> tuple[MemoryObject, str] | None:
        memory = self.get(memory_id)
        if not memory:
            return None
        path = self.files.resolve(memory.context.get("storage_key", ""))
        return (memory, path) if path else None

    def delete(self, memory_id: str) -> bool:
        memory = self.get(memory_id)
        if not memory:
            return False
        key = memory.context.get("storage_key", "")
        if not self.memories.delete(memory_id):
            return False
        self.files.delete(key)
        return True

    @staticmethod
    def _size_label(size: int) -> str:
        value = float(size)
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if value < 1024 or unit == "TB":
                return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
            value /= 1024
