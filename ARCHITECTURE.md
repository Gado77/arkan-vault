# Arkan Vault — Architecture

> Persistent memory layer for AI agents.
> **Status: MVP — Etapa 6A concluída. Biblioteca binária com deduplicação e downloads retomáveis.**

---

## Core Concept: MemoryObject

Everything in Arkan Vault is a **MemoryObject**.

A conversation. A decision. A task. An idea. A document. A person. A project.

There are no separate models (`Idea`, `Task`, `Person`). Only one model with a `type` field.

```
MemoryObject
    id            → "mem_{uuid4_hex}"   e.g. mem_3fa6d1c2a8b0...
    type          → "memory" | "conversation" | "decision" | "task" | "idea" | ...
    title         → string
    summary       → string (auto-generated or manual)
    content       → markdown string
    project       → string (grouping)
    tags          → string[]  (always lowercase-hyphenated)
    relations     → MemoryObject id[]
    context       → dict  (HOW and WHERE — see below)
    markdown_path → path to .md file
    created_at    → datetime (UTC)
    updated_at    → datetime (UTC)
```

### The `context` field

Captures the circumstances of how/where a memory was created.
Enables future queries without schema migrations:

```json
{
  "source": "voice",
  "created_by": "Hermes",
  "location": "Home",
  "device": "Notebook",
  "language": "pt-BR",
  "agent_session": "sess_abc123"
}
```

Future queries enabled by context:
- `"Show ideas I had via voice"`
- `"What did I record at the gym?"`
- `"Everything Hermes captured last week"`

---

## Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                       API (FastAPI)                      │  ← HTTP interface only
│                     api/routes/*.py                      │     No logic here
└───────────────────────────┬─────────────────────────────┘
                            │ publishes events
┌───────────────────────────▼─────────────────────────────┐
│                       Services                           │  ← Business logic & orchestration
│                     services/*.py                        │     Composes storage + core
│                                                          │     Publishes to events/bus.py
└────────────┬──────────────────────────┬─────────────────┘
             │                          │
┌────────────▼──────┐       ┌───────────▼─────────────────┐
│      Storage       │       │           Core               │
│   storage/*.py     │       │         core/*.py            │
│                    │       │                              │
│  MetadataStorage   │       │  embeddings.py  (generate)   │
│   → SQLite         │       │  vectors.py     (ChromaDB)   │
│                    │       │  markdown.py    (parse/write)│
│  MarkdownStorage   │       │  search.py      (rank/filter)│
│   → Filesystem     │       │  tags.py        (normalize)  │
│                    │       │                              │
│  VectorStorage     │       └──────────────────────────────┘
│   → ChromaDB       │          Stateless primitives
└────────────────────┘          No business logic
   Abstract interfaces
   Swappable impls.

┌──────────────────────────────────────────────────────────┐
│                      Events                              │  ← Decoupling layer
│   events/bus.py          → publish / subscribe           │
│   events/memory_events.py → MemoryCreated, etc.          │
└────────┬─────────────────────────────────────────────────┘
         │ subscribed by                │ subscribed by
┌────────▼──────────────┐   ┌──────────▼───────────────────┐
│   Knowledge Pipeline  │   │         Plugins              │
│  workers/knowledge_   │   │  plugins/hermes/             │
│  pipeline.py          │   │  plugins/whatsapp/           │
│                       │   │  plugins/...                 │
│  On MemoryCreated:    │   │  Never import services/      │
│   1. embed content    │   │  directly — only subscribe   │
│   2. save to vector   │   └──────────────────────────────┘
│      storage          │
│                       │
│  Future stages:       │
│   - auto-summarize    │
│   - extract entities  │
│   - detect relations  │
│   - compute scores    │
└───────────────────────┘
```

---

## Data Flow: Creating a Memory

```
POST /api/v1/memories
    │
    ▼
api/routes/memory.py           → Validate schema (Pydantic). Zero logic.
    │
    ▼
services/memory_service.py     → Orchestrate (all business logic here):
    │   1. Normalize tags              (core/tags.py)
    │   2. Generate mem_{uuid} ID
    │   3. Ensure context.source set   (default: "api")
    │   4. Save metadata               (storage/metadata_storage.py → SQLite)
    │   5. Save markdown file          (storage/markdown_storage.py → filesystem)
    │   6. publish(MemoryCreated(...)) (events/bus.py)
    │
    ▼  ← Returns immediately. HTTP response delivered.
Return MemoryObject (id: "mem_3fa6d1...")

    │  (asynchronously, in same process via event bus)
    ▼
workers/knowledge_pipeline.py  → Enrich memory:
    │   1. Load markdown content       (storage/markdown_storage.py)
    │   2. Generate embedding          (core/embeddings.py → sentence-transformers)
    │   3. Save vector                 (storage/vector_storage.py → ChromaDB)
    │   4. publish(EmbeddingGenerated) (events/bus.py)
    │
    (future stages: auto-summarize, extract entities, detect relations)
```

> **Invariant**: `MemoryService` never imports from `core/embeddings.py`.
> Embedding is the pipeline's responsibility, not the service's.

## Data Flow: Hybrid Search

```
GET /api/v1/memories/search?q=...&mode=hybrid
    │
    ▼
api/routes/memory.py            → Parse query params. Zero logic.
    │
    ▼
services/search_service.py      → search() method:
    │   1. Generate query embedding    (core/embeddings.py)
    │   2. Query vector store          (storage/vector_storage.py → ChromaDB)
    │   3. Fetch text candidates       (storage/metadata_storage.py → SQLite)
    │   4. Score lexical relevance     (core/search.py)
    │   5. Merge + rank both signals   (best signal + 15% agreement bonus)
    │   6. publish(SearchExecuted(...)) (events/bus.py)
    │                                  ↳ enables Hermes to learn query patterns
    ▼
Return list[SearchResult]  → memory_id + score + score_breakdown + MemoryObject
```

Modes: `semantic`, `text`, or `hybrid` (default). Scores are normalized to
`[0, 1]`; hybrid ranking preserves a strong result from either signal and
rewards agreement between them.

---

## Event System

All significant actions publish events. Plugins subscribe to events — never to services.

```python
# Subscribe (in a plugin)
from app.events import bus
from app.events.memory_events import MemoryCreated

bus.subscribe(MemoryCreated, my_handler)

# Publish (in a service)
bus.publish(MemoryCreated(memory_id="mem_abc123", type="idea"))
```

| Event             | Emitted when                  |
|-------------------|-------------------------------|
| MemoryCreated     | POST /memories succeeds       |
| MemoryUpdated     | PUT /memories/{id} succeeds   |
| MemoryDeleted     | DELETE /memories/{id}         |
| SearchExecuted    | GET /search completes         |
| EmbeddingGenerated| Embedding generated for memory|
| TagsNormalized    | Tags normalized on write      |

**MVP**: Synchronous bus. Future: swap `bus.py` internals for Redis/NATS/broker.

---

## Storage Backends

| Layer    | MVP Implementation   | Future Swap              |
|----------|----------------------|--------------------------|
| Metadata | SQLite               | Postgres, MongoDB        |
| Content  | Filesystem (.md)     | S3, GCS, R2              |
| Vectors  | ChromaDB             | Qdrant, Pinecone, pgvec  |

Swap = new class implementing the ABC. Zero changes in `services/`.

---

## Module Dependency Rules

```
api/       → may import: services/
services/  → may import: storage/, core/, events/
storage/   → may import: core/
core/      → may import: nothing internal (only stdlib + external libs)
events/    → may import: nothing internal
plugins/   → may import: events/ only (never services/, storage/, core/)
models/    → may import: database.py only
schemas/   → may import: models/ only
```

Violations = architecture bugs.

---

## Conventions

### IDs
- Format: `mem_{uuid4_hex}` — e.g. `mem_3fa6d1c2a8b04e1f9d7c2e5a1b3f8d9e`
- Generated at application layer, never at DB layer
- UUID hex prevents sync conflicts across devices
- Never use auto-increment integers

### Timestamps
- Always UTC. Stored as `DateTime(timezone=True)`.

### Tags
- Always lowercase-hyphenated: `"machine-learning"`, not `"Machine Learning"`
- Normalized on write via `core/tags.py`
- Emits `TagsNormalized` event

### Types
- Free string field — no enum at DB level (intentional)
- New types require zero migrations
- Pydantic schema can validate if needed

### Markdown files
- One `.md` file per MemoryObject
- Filename: `{id}.md` — e.g. `mem_3fa6d1....md`
- Path: `data/memories/{id}.md`
- DB stores path in `markdown_path`

### Context field
- Always a dict. Never null.
- Use for capture circumstances: source, device, location, agent, language
- Never add new columns for context attributes — use this field

---

## API Surface (MVP)

```
POST   /api/v1/memories                → Create MemoryObject
GET    /api/v1/memories                → List with filters (type, project, tags)
GET    /api/v1/memories/{id}           → Get single
PUT    /api/v1/memories/{id}           → Update
DELETE /api/v1/memories/{id}           → Delete

GET    /api/v1/memories/search?q=...   → semantic | text | hybrid (score breakdown)

GET    /health                         → System health
```

No auth. No users. Single-tenant for MVP.

---

## Decisions Log

| Decision | Rationale |
|---|---|
| Single `MemoryObject` model | No model explosion; type is extensible |
| `mem_` prefixed UUID | Readable, debuggable, sync-safe across devices |
| `context` JSON field | Captures capture circumstances without schema migrations |
| `core/` separated from `services/` | Primitives reusable by plugins and future modules |
| Abstract interfaces in `storage/` | Swap backends without touching business logic |
| `events/` bus | Decouples services from plugins/future integrations |
| `plugins/` directory | Future Hermes, WhatsApp, Discord — subscribes to events only |
| SQLite for MVP | Zero infra; Postgres-compatible via SQLAlchemy |
| ChromaDB for MVP | Local, no server; swappable via VectorStorageBase |
| `sentence-transformers` local | No API key; offline; swappable |
| Synchronous event bus | Simple for MVP; internals swappable for async/broker |
| UTC timestamps everywhere | No timezone bugs across agents and devices |
| Knowledge Pipeline in `workers/` | Single enrichment entry point; MemoryService never generates embeddings |
| `score` in search results | Enables future hybrid ranking (similarity + recency + frequency) |
| `SearchExecuted` event | Bus captures all queries — Hermes can learn query patterns over time |
| `/memories/search` (not `/search`) | Namespace consistency: `/files/search`, `/projects/search` in future |

---

## Module Dependency Rules (updated)

```
api/       → may import: services/
services/  → may import: storage/, core/tags.py, core/search.py, events/
workers/   → may import: storage/, core/, events/  (NOT services/)
core/      → may import: nothing internal (only stdlib + external libs)
storage/   → may import: models/ only
events/    → may import: nothing internal
plugins/   → may import: events/ only (never services/, storage/, core/)
models/    → may import: database.py only
schemas/   → may import: models/ only
```

> **Key invariant**: `services/memory_service.py` does NOT import `core/embeddings.py`.
> Embedding is the Knowledge Pipeline's responsibility.

---

## 🔴 Architecture Frozen

**Do not add new architectural layers or rename concepts.**

Completed milestones:
- ✅ Etapa 1: Server boots, `/health` responds
- ✅ Etapa 2: `POST /memories` → MemoryObject → SQLite + Markdown → returns `mem_` ID
- ✅ Etapa 3A: `MemoryCreated` → Knowledge Pipeline → embedding → ChromaDB
- ✅ Etapa 3B: `GET /memories/search` → semantic results with score
- ✅ Etapa 3C: Hybrid ranking (semantic + text + explainable score)
- ✅ Etapa 4: Web interface → CRUD + hybrid search + responsive UI
- ✅ Etapa 5A: Memory graph → relations + projects + tags + interactive Canvas
- ✅ Etapa 5B: Semantic edges from persisted embeddings, configurable threshold and explainable evidence
- ✅ Etapa 6A: Binary files as MemoryObjects, SHA-256 storage, deduplication and HTTP Range downloads
- ✅ Etapa 6B1: Safe text extraction, semantic indexing and persistent resumable chunk uploads
- ⬜ Etapa 6B2: Image/video/document previews and richer media metadata
- ⬜ Etapa 6: File library + resumable large transfers
- ✅ Etapa 7: Linux server + automatic backups + Tailscale private HTTPS access

Operational deployment details, paths and the canonical remote address are kept
in `DEPLOYMENT.md`. Deployment facts may change without changing the frozen
application architecture.
