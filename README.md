# Arkan Vault

> Persistent memory layer for AI agents.

## Architecture

```
backend/
├── app/
│   ├── main.py              # App factory + FastAPI instance
│   ├── config.py            # Settings (pydantic-settings)
│   ├── database.py          # SQLAlchemy engine + session
│   ├── api/
│   │   └── routes/          # One file per resource group
│   ├── models/              # SQLAlchemy ORM models
│   ├── schemas/             # Pydantic request/response schemas
│   ├── services/            # Business logic and orchestration
│   ├── storage/             # SQLite, Markdown and ChromaDB adapters
│   ├── core/                # Stateless search and embedding primitives
│   ├── events/              # Synchronous event bus
│   └── workers/             # Knowledge Pipeline
├── web/                     # Static browser interface
└── data/
    ├── arkan.db             # SQLite — metadata & relationships
    ├── chroma/              # ChromaDB — vector embeddings
    └── memories/            # Markdown files — memory content
```

## Quick Start

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

Web interface: http://localhost:8000/

API docs: http://localhost:8000/docs

## Servidor pessoal

Instalação ativa: <https://arkan-server.tail9b08be.ts.net/>

Esse é um endereço privado Tailscale. Consulte [DEPLOYMENT.md](DEPLOYMENT.md)
para caminhos dos dados, backups, serviço Linux, acesso remoto e migração.

Agentes externos, incluindo o Hermes, podem usar o cliente Python em
[`sdk/python`](sdk/python/README.md).

## Roadmap

- [x] Etapa 1 — Project structure
- [x] Etapa 2 — Memory model + CRUD routes
- [x] Etapa 3 — Semantic, text, and hybrid search + embeddings
- [x] Etapa 4 — Web interface
- [x] Etapa 5A — Interactive memory graph
- [x] Etapa 5B — Automatic semantic graph connections with evidence
- [x] Etapa 6A — Content-addressed file library, deduplication and resumable downloads
- [x] Etapa 6B1 — Text extraction, semantic indexing and resumable chunk uploads
- [ ] Etapa 6B2 — Image/video/document previews and richer metadata extraction
- [x] Etapa 7 — Linux personal server deployment, backups and private remote access
