"""
core/markdown.py — Markdown read/write primitive.

Responsibility: Parse and serialize markdown content.
No knowledge of KnowledgeObject or any business concept.
"""
# Implementation in Etapa 2
#
# from pathlib import Path
#
#
# def read_file(path: Path) -> str:
#     return path.read_text(encoding="utf-8")
#
#
# def write_file(path: Path, content: str) -> None:
#     path.parent.mkdir(parents=True, exist_ok=True)
#     path.write_text(content, encoding="utf-8")
#
#
# def delete_file(path: Path) -> None:
#     if path.exists():
#         path.unlink()
#
#
# def extract_frontmatter(content: str) -> tuple[dict, str]:
#     """Returns (metadata_dict, body_without_frontmatter)."""
#     ...
