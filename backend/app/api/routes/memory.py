"""
api/routes/memory.py — Rotas de MemoryObject

Responsabilidade única: adaptar HTTP → MemoryService → HTTP.

Regras:
  - Zero regra de negócio aqui
  - Zero acesso direto ao banco
  - Apenas: recebe request, chama service, devolve response
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.schemas.memory import MemoryCreate, MemoryResponse, MemoryUpdate
from app.schemas.search import SearchResult
from app.services.memory_service import MemoryService
from app.services.search_service import SearchService
from app.storage.chroma_storage import ChromaVectorStorage
from app.storage.markdown_storage import FilesystemMarkdownStorage
from app.storage.metadata_storage import SQLiteMetadataStorage

router = APIRouter(prefix="/memories", tags=["Memories"])


def get_memory_service(db: Session = Depends(get_db)) -> MemoryService:
    """Dependency: monta o MemoryService com suas implementações de storage."""
    return MemoryService(
        metadata=SQLiteMetadataStorage(db),
        markdown=FilesystemMarkdownStorage(settings.MEMORIES_PATH),
    )


def get_search_service(db: Session = Depends(get_db)) -> SearchService:
    return SearchService(
        metadata=SQLiteMetadataStorage(db),
        vector=ChromaVectorStorage(),
    )


@router.post("", response_model=MemoryResponse, status_code=201)
def create_memory(
    data: MemoryCreate,
    service: MemoryService = Depends(get_memory_service),
):
    """Cria um novo MemoryObject. Toda lógica vive no MemoryService."""
    return service.create(data)


@router.get("/search", response_model=list[SearchResult])
def search_memories(
    q: str = Query(..., min_length=1, description="Texto de busca semântica"),
    limit: int = Query(default=10, ge=1, le=100),
    type: str | None = Query(default=None),
    project: str | None = Query(default=None),
    tags: list[str] | None = Query(default=None),
    mode: Literal["semantic", "text", "hybrid"] = Query(default="hybrid"),
    service: SearchService = Depends(get_search_service),
):
    """Busca semântica, textual ou híbrida com score explicável."""
    return service.search(
        q=q,
        limit=limit,
        type=type,
        project=project,
        tags=tags,
        mode=mode,
    )


@router.get("", response_model=list[MemoryResponse])
def list_memories(
    type: str | None = Query(default=None),
    project: str | None = Query(default=None),
    tags: list[str] | None = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    service: MemoryService = Depends(get_memory_service),
):
    """Lista MemoryObjects com filtros opcionais."""
    return service.list(type=type, project=project, tags=tags, limit=limit, offset=offset)


@router.get("/{id}", response_model=MemoryResponse)
def get_memory(id: str, service: MemoryService = Depends(get_memory_service)):
    """Retorna um MemoryObject pelo ID."""
    obj = service.get(id)
    if not obj:
        raise HTTPException(status_code=404, detail=f"Memory '{id}' not found.")
    return obj


@router.put("/{id}", response_model=MemoryResponse)
def update_memory(
    id: str,
    data: MemoryUpdate,
    service: MemoryService = Depends(get_memory_service),
):
    """Atualiza campos de um MemoryObject. Apenas campos enviados são alterados."""
    obj = service.update(id, data)
    if not obj:
        raise HTTPException(status_code=404, detail=f"Memory '{id}' not found.")
    return obj


@router.delete("/{id}", status_code=204)
def delete_memory(id: str, service: MemoryService = Depends(get_memory_service)):
    """Remove um MemoryObject e seu arquivo .md associado."""
    deleted = service.delete(id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Memory '{id}' not found.")
