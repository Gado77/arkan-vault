"""HTTP adapter for the memory graph."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.graph import GraphResponse
from app.services.graph_service import GraphService
from app.storage.metadata_storage import SQLiteMetadataStorage
from app.storage.chroma_storage import ChromaVectorStorage


router = APIRouter(prefix="/graph", tags=["Graph"])


def get_graph_service(db: Session = Depends(get_db)) -> GraphService:
    return GraphService(
        metadata=SQLiteMetadataStorage(db),
        vector=ChromaVectorStorage(),
    )


@router.get("", response_model=GraphResponse)
def get_graph(
    type: str | None = Query(default=None),
    project: str | None = Query(default=None),
    tags: list[str] | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    include_semantic: bool = Query(default=True),
    semantic_threshold: float = Query(default=0.53, ge=0.0, le=1.0),
    semantic_neighbors: int = Query(default=3, ge=1, le=10),
    since_days: int | None = Query(default=None, ge=1, le=3650),
    service: GraphService = Depends(get_graph_service),
):
    return service.build(
        type=type,
        project=project,
        tags=tags,
        limit=limit,
        include_semantic=include_semantic,
        semantic_threshold=semantic_threshold,
        semantic_neighbors=semantic_neighbors,
        since_days=since_days,
    )
