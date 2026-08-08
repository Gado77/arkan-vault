"""Schemas for binary files represented by MemoryObjects."""
from pydantic import BaseModel, Field

from app.schemas.memory import MemoryResponse


class FileUploadResponse(BaseModel):
    memory: MemoryResponse
    deduplicated: bool
    download_url: str


class ResumableUploadCreate(BaseModel):
    filename: str
    size_bytes: int
    content_type: str | None = None
    project: str | None = None
    tags: list[str] = Field(default_factory=list)
    sha256: str | None = None


class ResumableUploadStatus(BaseModel):
    upload_id: str
    filename: str
    size_bytes: int
    received_bytes: int
    chunk_size: int = 8 * 1024 * 1024
