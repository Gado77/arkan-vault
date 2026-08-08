# Arkan Vault — Data Directory

This directory stores all persistent data:

- `arkan.db` — SQLite database (metadata, relationships, tags)
- `chroma/` — ChromaDB vector store (embeddings for semantic search)
- `memories/` — Markdown files (one .md per memory)

All three are the source of truth and should be backed up together.
# Arkan Vault persistent data

- `arkan.db`: MemoryObject metadata in SQLite.
- `memories/`: human-readable Markdown content.
- `chroma/`: semantic vector index.
- `files/originals/<prefix>/<sha256>`: immutable binary originals addressed by content hash.
- `files/.tmp/`: temporary upload chunks; safe to clear only while Arkan Vault is stopped.
- `files/uploads/`: persistent resumable-upload sessions; do not clear while an upload may be resumed.

For backup or migration, stop the service and copy this entire `data/` directory as one unit.
