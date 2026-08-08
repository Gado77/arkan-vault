"""
storage/markdown_storage.py

Interface abstrata + implementação filesystem para conteúdo .md do MemoryObject.
Para trocar filesystem por S3/GCS: crie S3MarkdownStorage com a mesma interface.
"""
from abc import ABC, abstractmethod
from pathlib import Path


class MarkdownStorageBase(ABC):
    """Contrato abstrato. Qualquer implementação deve respeitar esta interface."""

    @abstractmethod
    def save(self, id: str, content: str) -> str:
        """Salva conteúdo e retorna o caminho do arquivo."""
        ...

    @abstractmethod
    def get(self, id: str) -> str | None:
        """Retorna conteúdo markdown bruto ou None se não encontrado."""
        ...

    @abstractmethod
    def delete(self, id: str) -> bool: ...


class FilesystemMarkdownStorage(MarkdownStorageBase):
    """Implementação filesystem. Um arquivo .md por MemoryObject."""

    def __init__(self, base_path: str):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _path(self, id: str) -> Path:
        return self.base_path / f"{id}.md"

    def save(self, id: str, content: str) -> str:
        path = self._path(id)
        path.write_text(content, encoding="utf-8")
        return str(path)

    def get(self, id: str) -> str | None:
        path = self._path(id)
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8")

    def delete(self, id: str) -> bool:
        path = self._path(id)
        if path.exists():
            path.unlink()
            return True
        return False
