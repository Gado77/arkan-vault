from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.system import SystemStatus
from app.services.system_service import SystemService
from app.storage.chroma_storage import ChromaVectorStorage
from app.storage.metadata_storage import SQLiteMetadataStorage

router = APIRouter(prefix="/system", tags=["System"])

def get_system_service(db: Session = Depends(get_db)) -> SystemService:
    return SystemService(SQLiteMetadataStorage(db), ChromaVectorStorage())

@router.get("/status", response_model=SystemStatus)
def get_system_status(service: SystemService = Depends(get_system_service)):
    return service.status()
