#!/usr/bin/env bash
set -Eeuo pipefail

readonly BACKUP_DIR="/var/backups/arkan-vault"
archive="${1:-}"

if [[ -z "$archive" ]]; then
  archive="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'arkan-vault-*.tar.gz' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
fi

[[ -n "$archive" && -f "$archive" ]] || {
  echo "No backup archive found." >&2
  exit 1
}

checksum="$archive.sha256"
[[ -f "$checksum" ]] || {
  echo "Missing checksum: $checksum" >&2
  exit 1
}

sha256sum --check "$checksum"
temporary="$(mktemp -d /tmp/arkan-vault-verify.XXXXXX)"
trap 'rm -rf -- "$temporary"' EXIT
tar --extract --gzip --file "$archive" --directory "$temporary"

python3 - "$temporary/data" <<'PY'
import sqlite3
import sys
from pathlib import Path

data = Path(sys.argv[1])
database = data / "arkan.db"
if not database.is_file():
    raise SystemExit("arkan.db is missing from backup")

with sqlite3.connect(database) as connection:
    result = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise SystemExit(f"SQLite integrity check failed: {result}")
    memories = connection.execute("SELECT COUNT(*) FROM memory_objects").fetchone()[0]

markdown = len(list((data / "memories").glob("*.md")))
originals = sum(1 for path in (data / "files" / "originals").rglob("*") if path.is_file())
chroma = data / "chroma" / "chroma.sqlite3"
if not chroma.is_file():
    raise SystemExit("ChromaDB database is missing from backup")

with sqlite3.connect(chroma) as connection:
    result = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise SystemExit(f"ChromaDB integrity check failed: {result}")

print(f"Backup verified: memories={memories}, markdown={markdown}, originals={originals}")
PY
