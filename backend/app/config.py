from pydantic_settings import BaseSettings
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Arkan Vault"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    # Database
    SQLITE_URL: str = f"sqlite:///{BASE_DIR}/data/arkan.db"

    # ChromaDB
    CHROMA_PATH: str = str(BASE_DIR / "data" / "chroma")

    # Markdown storage
    MEMORIES_PATH: str = str(BASE_DIR / "data" / "memories")

    # Binary file library
    FILES_PATH: str = str(BASE_DIR / "data" / "files")
    MAX_UPLOAD_BYTES: int = 50 * 1024 * 1024 * 1024  # 50 GB
    MAX_EXTRACT_BYTES: int = 2_000_000
    MAX_EXTRACT_CHARS: int = 20_000

    # Embedding model (local, no API key needed for MVP)
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"

    class Config:
        env_file = ".env"


settings = Settings()
