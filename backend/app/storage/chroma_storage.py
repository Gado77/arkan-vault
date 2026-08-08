"""
storage/chroma_storage.py

ChromaDB implementation for vector embeddings.
"""
from typing import Any, Dict, List, Optional
from app.config import settings
from app.core.vectors import distance_to_score
from app.storage.vector_storage import VectorStorageBase

class ChromaVectorStorage(VectorStorageBase):
    def __init__(self, collection_name: str = "arkan_vault"):
        # Lazy import to avoid crashing if chromadb isn't installed
        import chromadb
        from chromadb.config import Settings
        
        self.client = chromadb.PersistentClient(
            path=settings.CHROMA_PATH,
            settings=Settings(anonymized_telemetry=False),
        )
        self.collection = self.client.get_or_create_collection(name=collection_name)

    def save(self, id: str, embedding: List[float], metadata: Dict[str, Any]) -> None:
        """Saves or updates an embedding."""
        # chromadb expects list of dicts for metadata, lists of lists for embeddings, etc.
        # But for a single element, we can pass a list of 1.
        self.collection.upsert(
            ids=[id],
            embeddings=[embedding],
            metadatas=[metadata]
        )

    def search(
        self, 
        embedding: List[float], 
        limit: int = 10, 
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Searches for similar embeddings."""
        collection_size = self.collection.count()
        if collection_size == 0:
            return []

        results = self.collection.query(
            query_embeddings=[embedding],
            n_results=min(limit, collection_size),
            where=filters
        )
        
        output = []
        if results and "ids" in results and results["ids"]:
            ids = results["ids"][0]
            distances = results["distances"][0] if "distances" in results else []
            metadatas = results["metadatas"][0] if "metadatas" in results else []
            
            for i in range(len(ids)):
                distance = distances[i] if i < len(distances) else None
                output.append({
                    "memory_id": ids[i],
                    "score": distance_to_score(distance),
                    "metadata": metadatas[i] if i < len(metadatas) else {}
                })
        return output

    def similar(self, id: str, limit: int = 3, min_score: float = 0.53) -> List[Dict[str, Any]]:
        """Find semantic neighbours from an embedding that is already persisted."""
        if limit < 1 or self.collection.count() < 2:
            return []

        stored = self.collection.get(ids=[id], include=["embeddings"])
        embeddings = stored.get("embeddings") if stored else None
        if embeddings is None or len(embeddings) == 0:
            return []

        results = self.search(embeddings[0], limit=limit + 1)
        return [
            result for result in results
            if result["memory_id"] != id and result["score"] >= min_score
        ][:limit]

    def delete(self, id: str) -> bool:
        """Deletes an embedding."""
        try:
            self.collection.delete(ids=[id])
            return True
        except Exception:
            return False
