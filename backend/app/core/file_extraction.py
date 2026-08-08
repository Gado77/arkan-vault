"""Safe, stateless text extraction primitives for binary files."""
from pathlib import Path


TEXT_EXTENSIONS = {
    ".txt", ".md", ".rst", ".json", ".jsonl", ".csv", ".tsv", ".xml",
    ".html", ".css", ".js", ".ts", ".py", ".java", ".c", ".cpp", ".h",
    ".go", ".rs", ".sql", ".yaml", ".yml", ".toml", ".ini", ".log",
    ".sh", ".ps1", ".bat",
}


def extract_text(path: str, filename: str, mime_type: str, *, max_bytes: int = 2_000_000, max_chars: int = 20_000) -> str | None:
    file_path = Path(path)
    if file_path.stat().st_size > max_bytes:
        return None
    if not mime_type.startswith("text/") and Path(filename).suffix.lower() not in TEXT_EXTENSIONS and mime_type not in {"application/json", "application/xml", "application/javascript"}:
        return None
    raw = file_path.read_bytes()
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        return None
    text = text.replace("\x00", "").strip()
    return text[:max_chars] if text else None
