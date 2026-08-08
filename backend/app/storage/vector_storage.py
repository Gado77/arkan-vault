"""
storage/vector_storage.py

Interface for vector embeddings.
Swap implementation here to move to Qdrant, Pinecone, pgvector, etc.
"""
from abc import ABC, abstractmethod


class VectorStorageBase(ABC):
    """Abstract interface. Any implementation must satisfy this contract."""

    @abstractmethod
    def save(self, id: str, embedding: list[float], metadata: dict) -> None:
        ...

    @abstractmethod
    def search(self, embedding: list[float], limit: int = 10, filters: dict | None = None) -> list[dict]:
        ...

    @abstractmethod
    def similar(self, id: str, limit: int = 3, min_score: float = 0.53) -> list[dict]:
        """Return the closest stored memories to an existing vector, excluding itself."""
        ...

    @abstractmethod
    def delete(self, id: str) -> bool:
        ...
