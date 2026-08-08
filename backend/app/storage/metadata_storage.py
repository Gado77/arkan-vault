"""
storage/metadata_storage.py

Interface abstrata + implementação SQLite para metadados do MemoryObject.
Para trocar SQLite por Postgres: crie PostgresMetadataStorage com a mesma interface.
"""
from abc import ABC, abstractmethod
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.memory import MemoryObject


class MetadataStorageBase(ABC):
    """Contrato abstrato. Qualquer implementação deve respeitar esta interface."""

    @abstractmethod
    def save(self, obj: MemoryObject) -> MemoryObject: ...

    @abstractmethod
    def get(self, id: str) -> MemoryObject | None: ...

    @abstractmethod
    def list(
        self,
        type: str | None = None,
        project: str | None = None,
        tags: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[MemoryObject]: ...

    @abstractmethod
    def update(self, id: str, data: dict) -> MemoryObject | None: ...

    @abstractmethod
    def find_by_context(self, key: str, value: object, type: str | None = None) -> MemoryObject | None: ...

    @abstractmethod
    def delete(self, id: str) -> bool: ...


class SQLiteMetadataStorage(MetadataStorageBase):
    """Implementação SQLite via SQLAlchemy. Sessão injetada pelo caller."""

    def __init__(self, db: Session):
        self.db = db

    def save(self, obj: MemoryObject) -> MemoryObject:
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def get(self, id: str) -> MemoryObject | None:
        return self.db.get(MemoryObject, id)

    def list(
        self,
        type: str | None = None,
        project: str | None = None,
        tags: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[MemoryObject]:
        query = self.db.query(MemoryObject).order_by(MemoryObject.created_at.desc())

        if type:
            query = query.filter(MemoryObject.type == type)
        if project:
            query = query.filter(MemoryObject.project == project)
        # Tag filtering: JSON contains — feito em memória por ora (SQLite não tem JSON_CONTAINS)
        # Em Postgres, substituir por jsonb @> operator
        results = query.offset(offset).limit(limit).all()

        if tags:
            tag_set = set(tags)
            results = [r for r in results if tag_set.issubset(set(r.tags))]

        return results

    def update(self, id: str, data: dict) -> MemoryObject | None:
        obj = self.get(id)
        if not obj:
            return None
        for key, value in data.items():
            setattr(obj, key, value)
        obj.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def find_by_context(self, key: str, value: object, type: str | None = None) -> MemoryObject | None:
        query = self.db.query(MemoryObject)
        if type:
            query = query.filter(MemoryObject.type == type)
        return query.filter(MemoryObject.context[key].as_string() == str(value)).first()

    def delete(self, id: str) -> bool:
        obj = self.get(id)
        if not obj:
            return False
        self.db.delete(obj)
        self.db.commit()
        return True
