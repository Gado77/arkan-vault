from datetime import datetime, timezone
from pathlib import Path
import os
import shutil
import socket
import time

from app.config import settings
from app.schemas.system import BackupStatus, StorageStatus, SystemStatus
from app.storage.metadata_storage import MetadataStorageBase
from app.storage.vector_storage import VectorStorageBase

_STARTED_AT = time.monotonic()

class SystemService:
    def __init__(self, metadata: MetadataStorageBase, vector: VectorStorageBase | None = None):
        self.metadata = metadata
        self.vector = vector

    def status(self) -> SystemStatus:
        memories = self.metadata.list(limit=2000, offset=0)
        data_path = Path(settings.MEMORIES_PATH).parent
        disk = shutil.disk_usage(data_path)
        vector_count = None
        collection = getattr(self.vector, "collection", None)
        if collection is not None:
            try:
                vector_count = collection.count()
            except Exception:
                pass
        return SystemStatus(
            status="ok", version=settings.APP_VERSION, hostname=socket.gethostname(),
            uptime_seconds=max(0, int(time.monotonic() - _STARTED_AT)),
            memories=len(memories), files=sum(m.type == "file" for m in memories),
            markdown_files=len(list(Path(settings.MEMORIES_PATH).glob("*.md"))),
            vector_count=vector_count,
            storage=StorageStatus(total_bytes=disk.total, used_bytes=disk.used,
                free_bytes=disk.free, used_percent=round(disk.used / disk.total * 100, 1),
                vault_bytes=self._directory_size(data_path)),
            backup=self._latest_backup(),
        )

    @staticmethod
    def _directory_size(path: Path) -> int:
        total = 0
        for root, _, files in os.walk(path):
            for name in files:
                try: total += (Path(root) / name).stat().st_size
                except OSError: pass
        return total

    @staticmethod
    def _latest_backup() -> BackupStatus:
        try:
            latest = max(Path("/var/backups/arkan-vault").glob("arkan-vault-*.tar.gz"), key=lambda p: p.stat().st_mtime)
            stat = latest.stat()
        except (OSError, ValueError):
            return BackupStatus(available=False)
        return BackupStatus(available=True, filename=latest.name, size_bytes=stat.st_size,
            created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc))
