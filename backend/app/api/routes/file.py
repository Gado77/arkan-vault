"""HTTP adapter for the Arkan Vault file library."""
from pathlib import Path
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.schemas.file import FileUploadResponse, ResumableUploadCreate, ResumableUploadStatus
from app.schemas.memory import MemoryResponse
from app.services.file_service import FileService
from app.services.memory_service import MemoryService
from app.storage.file_storage import FilesystemFileStorage
from app.storage.markdown_storage import FilesystemMarkdownStorage
from app.storage.metadata_storage import SQLiteMetadataStorage

router = APIRouter(prefix="/files", tags=["Files"])
CHUNK_SIZE = 8 * 1024 * 1024


def get_file_service(db: Session = Depends(get_db)) -> FileService:
    metadata = SQLiteMetadataStorage(db)
    memories = MemoryService(metadata, FilesystemMarkdownStorage(settings.MEMORIES_PATH))
    return FileService(metadata, memories, FilesystemFileStorage(settings.FILES_PATH), settings.MAX_UPLOAD_BYTES, settings.MAX_EXTRACT_BYTES, settings.MAX_EXTRACT_CHARS)


@router.post("", response_model=FileUploadResponse, status_code=201)
def upload_file(file: UploadFile = File(...), project: str | None = Form(default=None), tags: str | None = Form(default=None), service: FileService = Depends(get_file_service)):
    try:
        memory, deduplicated = service.upload(file.file, file.filename or "arquivo", file.content_type, project, (tags or "").split(",") if tags else [])
    except ValueError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    return {"memory": memory, "deduplicated": deduplicated, "download_url": f"/api/v1/files/{memory.id}/download"}


@router.post("/uploads", response_model=ResumableUploadStatus, status_code=201)
def create_resumable_upload(data: ResumableUploadCreate, service: FileService = Depends(get_file_service)):
    try:
        session = service.start_upload(data.filename, data.size_bytes, data.content_type, data.project, data.tags, data.sha256)
    except ValueError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    return {**session, "chunk_size": CHUNK_SIZE}


@router.get("/uploads/{upload_id}", response_model=ResumableUploadStatus)
def resumable_upload_status(upload_id: str, service: FileService = Depends(get_file_service)):
    session = service.upload_status(upload_id)
    if not session:
        raise HTTPException(status_code=404, detail="Upload session not found.")
    return {**session, "chunk_size": CHUNK_SIZE}


@router.put("/uploads/{upload_id}", response_model=ResumableUploadStatus)
async def append_resumable_upload(upload_id: str, request: Request, upload_offset: int = Header(alias="Upload-Offset"), service: FileService = Depends(get_file_service)):
    chunk = await request.body()
    if not chunk or len(chunk) > CHUNK_SIZE:
        raise HTTPException(status_code=413, detail=f"Chunk must contain 1 to {CHUNK_SIZE} bytes.")
    try:
        session = service.append_upload(upload_id, upload_offset, chunk)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Upload session not found.") from error
    except ValueError as error:
        expected = service.upload_status(upload_id)
        headers = {"Upload-Offset": str(expected["received_bytes"])} if expected else None
        raise HTTPException(status_code=409, detail=str(error), headers=headers) from error
    return {**session, "chunk_size": CHUNK_SIZE}


@router.post("/uploads/{upload_id}/complete", response_model=FileUploadResponse)
def complete_resumable_upload(upload_id: str, service: FileService = Depends(get_file_service)):
    try:
        memory, deduplicated = service.complete_upload(upload_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Upload session not found.") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"memory": memory, "deduplicated": deduplicated, "download_url": f"/api/v1/files/{memory.id}/download"}


@router.get("", response_model=list[MemoryResponse])
def list_files(limit: int = Query(default=200, ge=1, le=1000), offset: int = Query(default=0, ge=0), service: FileService = Depends(get_file_service)):
    return service.list(limit, offset)


@router.get("/{memory_id}", response_model=MemoryResponse)
def get_file(memory_id: str, service: FileService = Depends(get_file_service)):
    memory = service.get(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="File memory not found.")
    return memory


@router.get("/{memory_id}/download")
def download_file(memory_id: str, range_header: str | None = Header(default=None, alias="Range"), service: FileService = Depends(get_file_service)):
    result = service.download(memory_id)
    if not result:
        raise HTTPException(status_code=404, detail="File or binary content not found.")
    memory, path = result
    mime = memory.context.get("mime_type") or "application/octet-stream"
    filename = memory.context.get("original_filename") or memory.title
    if not range_header:
        return FileResponse(path, media_type=mime, filename=filename, headers={"Accept-Ranges": "bytes"})

    size = Path(path).stat().st_size
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
    if not match:
        raise HTTPException(status_code=416, detail="Invalid byte range.", headers={"Content-Range": f"bytes */{size}"})
    start_text, end_text = match.groups()
    if not start_text and not end_text:
        raise HTTPException(status_code=416, detail="Invalid byte range.", headers={"Content-Range": f"bytes */{size}"})
    if start_text:
        start = int(start_text)
        end = min(int(end_text), size - 1) if end_text else size - 1
    else:
        suffix = int(end_text)
        start = max(size - suffix, 0)
        end = size - 1
    if start >= size or start > end:
        raise HTTPException(status_code=416, detail="Range outside file.", headers={"Content-Range": f"bytes */{size}"})

    length = end - start + 1
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Range": f"bytes {start}-{end}/{size}",
        "Content-Length": str(length),
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
    }
    return StreamingResponse(_read_range(path, start, length), status_code=206, media_type=mime, headers=headers)


def _read_range(path: str, start: int, length: int):
    with open(path, "rb") as stream:
        stream.seek(start)
        remaining = length
        while remaining:
            chunk = stream.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@router.delete("/{memory_id}", status_code=204)
def delete_file(memory_id: str, service: FileService = Depends(get_file_service)):
    if not service.delete(memory_id):
        raise HTTPException(status_code=404, detail="File memory not found.")
