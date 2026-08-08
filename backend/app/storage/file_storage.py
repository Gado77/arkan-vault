"""Abstract file storage and local content-addressed implementation."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import BinaryIO
import uuid


@dataclass(frozen=True)
class StoredFile:
    key: str
    path: str
    sha256: str
    size: int
    created: bool


class FileStorageBase(ABC):
    @abstractmethod
    def save(self, stream: BinaryIO, max_bytes: int) -> StoredFile: ...

    @abstractmethod
    def resolve(self, key: str) -> str | None: ...

    @abstractmethod
    def delete(self, key: str) -> bool: ...

    @abstractmethod
    def create_upload(self, metadata: dict) -> dict: ...

    @abstractmethod
    def append_upload(self, upload_id: str, offset: int, data: bytes, max_bytes: int) -> dict: ...

    @abstractmethod
    def finish_upload(self, upload_id: str, max_bytes: int) -> tuple[StoredFile, dict]: ...

    @abstractmethod
    def upload_status(self, upload_id: str) -> dict | None: ...


class FilesystemFileStorage(FileStorageBase):
    """Stores immutable blobs under originals/<hash-prefix>/<sha256>."""

    def __init__(self, base_path: str):
        self.base_path = Path(base_path).resolve()
        self.originals = self.base_path / "originals"
        self.temporary = self.base_path / ".tmp"
        self.uploads = self.base_path / "uploads"
        self.originals.mkdir(parents=True, exist_ok=True)
        self.temporary.mkdir(parents=True, exist_ok=True)
        self.uploads.mkdir(parents=True, exist_ok=True)

    def save(self, stream: BinaryIO, max_bytes: int) -> StoredFile:
        digest = sha256()
        size = 0
        temporary_path: Path | None = None
        try:
            with NamedTemporaryFile(dir=self.temporary, delete=False) as temporary:
                temporary_path = Path(temporary.name)
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError(f"File exceeds the {max_bytes} byte upload limit.")
                    digest.update(chunk)
                    temporary.write(chunk)

            checksum = digest.hexdigest()
            key = f"originals/{checksum[:2]}/{checksum}"
            destination = self._safe_path(key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            created = not destination.exists()
            if created:
                temporary_path.replace(destination)
                temporary_path = None
            return StoredFile(key=key, path=str(destination), sha256=checksum, size=size, created=created)
        finally:
            if temporary_path and temporary_path.exists():
                temporary_path.unlink()

    def resolve(self, key: str) -> str | None:
        try:
            path = self._safe_path(key)
        except ValueError:
            return None
        return str(path) if path.is_file() else None

    def delete(self, key: str) -> bool:
        path_value = self.resolve(key)
        if not path_value:
            return False
        Path(path_value).unlink()
        return True

    def create_upload(self, metadata: dict) -> dict:
        upload_id = f"upl_{uuid.uuid4().hex}"
        directory = self._upload_directory(upload_id)
        directory.mkdir()
        payload = {**metadata, "upload_id": upload_id, "received_bytes": 0}
        (directory / "metadata.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        (directory / "payload.part").touch()
        return payload

    def upload_status(self, upload_id: str) -> dict | None:
        try:
            directory = self._upload_directory(upload_id)
        except ValueError:
            return None
        metadata_path, payload_path = directory / "metadata.json", directory / "payload.part"
        if not metadata_path.is_file() or not payload_path.is_file():
            return None
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["received_bytes"] = payload_path.stat().st_size
        return metadata

    def append_upload(self, upload_id: str, offset: int, data: bytes, max_bytes: int) -> dict:
        status = self.upload_status(upload_id)
        if not status:
            raise FileNotFoundError(upload_id)
        if offset != status["received_bytes"]:
            raise ValueError(f"Offset mismatch. Server expects {status['received_bytes']}.")
        expected_size = int(status["size_bytes"])
        if offset + len(data) > expected_size or offset + len(data) > max_bytes:
            raise ValueError("Chunk exceeds declared file size or upload limit.")
        payload_path = self._upload_directory(upload_id) / "payload.part"
        with payload_path.open("ab") as payload:
            payload.write(data)
        status["received_bytes"] = offset + len(data)
        return status

    def finish_upload(self, upload_id: str, max_bytes: int) -> tuple[StoredFile, dict]:
        status = self.upload_status(upload_id)
        if not status:
            raise FileNotFoundError(upload_id)
        if status["received_bytes"] != int(status["size_bytes"]):
            raise ValueError("Upload is incomplete.")
        directory = self._upload_directory(upload_id)
        with (directory / "payload.part").open("rb") as payload:
            stored = self.save(payload, max_bytes)
        expected_hash = status.get("sha256")
        if expected_hash and expected_hash.lower() != stored.sha256:
            if stored.created:
                self.delete(stored.key)
            raise ValueError("SHA-256 verification failed.")
        (directory / "payload.part").unlink()
        (directory / "metadata.json").unlink()
        directory.rmdir()
        return stored, status

    def _safe_path(self, key: str) -> Path:
        candidate = (self.base_path / key).resolve()
        if candidate == self.base_path or self.base_path not in candidate.parents:
            raise ValueError("Invalid storage key.")
        return candidate

    def _upload_directory(self, upload_id: str) -> Path:
        if not upload_id.startswith("upl_") or len(upload_id) != 36 or any(character not in "0123456789abcdef" for character in upload_id[4:]):
            raise ValueError("Invalid upload id.")
        return self.uploads / upload_id
