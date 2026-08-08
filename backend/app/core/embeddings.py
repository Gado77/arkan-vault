"""
core/embeddings.py — Embedding generation primitive.

Responsibility: Generate vector embeddings from text.
No knowledge of MemoryObject or any business concept.
"""
from app.config import settings


_model = None

def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(settings.EMBEDDING_MODEL)
    return _model


def embed(text: str) -> list[float]:
    """Generate embedding for a single text string."""
    model = _get_model()
    # ensure it returns a list of floats
    return model.encode(text).tolist()


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a batch of text strings."""
    model = _get_model()
    return model.encode(texts).tolist()
