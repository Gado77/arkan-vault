from datetime import datetime
from pydantic import BaseModel

class StorageStatus(BaseModel):
    total_bytes: int
    used_bytes: int
    free_bytes: int
    used_percent: float
    vault_bytes: int

class BackupStatus(BaseModel):
    available: bool
    created_at: datetime | None = None
    size_bytes: int | None = None
    filename: str | None = None

class SystemStatus(BaseModel):
    status: str
    version: str
    hostname: str
    uptime_seconds: int
    memories: int
    files: int
    markdown_files: int
    vector_count: int | None = None
    storage: StorageStatus
    backup: BackupStatus
