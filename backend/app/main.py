from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.config import settings


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="Persistent memory layer for AI agents.",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Open for MVP — restrict in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Startup ───────────────────────────────────────────────
    @app.on_event("startup")
    def on_startup():
        """Cria tabelas no SQLite, garante que data/ existe e inicia background workers."""
        from app.database import Base, engine
        # Importar modelos para que o Base os registre
        from app.models import memory  # noqa: F401

        Base.metadata.create_all(bind=engine)
        
        # Iniciar o Knowledge Pipeline para escutar eventos
        from app.workers.knowledge_pipeline import start_knowledge_pipeline
        try:
            start_knowledge_pipeline()
        except Exception as e:
            print(f"Warning: Failed to start Knowledge Pipeline: {e}")

    # ── Routes ────────────────────────────────────────────────
    from app.api.routes import file, graph, memory, system
    app.include_router(graph.router, prefix="/api/v1")
    app.include_router(memory.router, prefix="/api/v1")
    app.include_router(file.router, prefix="/api/v1")
    app.include_router(system.router, prefix="/api/v1")

    web_dir = Path(__file__).resolve().parent.parent / "web"
    app.mount("/assets", StaticFiles(directory=web_dir), name="assets")

    @app.get("/", include_in_schema=False)
    def web_interface():
        return FileResponse(web_dir / "index.html")

    # ── Health ────────────────────────────────────────────────
    @app.get("/health", tags=["System"])
    def health_check():
        return {"status": "ok", "version": settings.APP_VERSION}

    return app


app = create_app()
