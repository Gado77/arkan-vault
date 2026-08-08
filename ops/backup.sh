#!/usr/bin/env bash
set -Eeuo pipefail

readonly SOURCE_DIR="/opt/arkan-vault/backend/data"
readonly BACKUP_DIR="/var/backups/arkan-vault"
readonly SERVICE="arkan-vault.service"
readonly RETENTION_DAYS="${ARKAN_BACKUP_RETENTION_DAYS:-14}"
readonly LOCK_FILE="/run/lock/arkan-vault-backup.lock"

mkdir -p "$BACKUP_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || {
  echo "Another Arkan Vault backup is already running." >&2
  exit 1
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$BACKUP_DIR/arkan-vault-$timestamp.tar.gz"
temporary="$archive.partial"
service_was_active=0

cleanup() {
  rm -f "$temporary"
  if (( service_was_active )) && ! systemctl is-active --quiet "$SERVICE"; then
    systemctl start "$SERVICE"
  fi
}
trap cleanup EXIT

if systemctl is-active --quiet "$SERVICE"; then
  service_was_active=1
  systemctl stop "$SERVICE"
fi

tar \
  --create \
  --gzip \
  --file "$temporary" \
  --directory "$(dirname "$SOURCE_DIR")" \
  --exclude='data/*.log' \
  --exclude='data/backups' \
  data

mv "$temporary" "$archive"
sha256sum "$archive" > "$archive.sha256"

if (( service_was_active )); then
  systemctl start "$SERVICE"
  for _ in {1..30}; do
    if curl --fail --silent --show-error --max-time 2 \
      http://127.0.0.1:8765/health >/dev/null; then
      break
    fi
    sleep 1
  done
  curl --fail --silent --show-error --max-time 2 \
    http://127.0.0.1:8765/health >/dev/null
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'arkan-vault-*.tar.gz' -o -name 'arkan-vault-*.tar.gz.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete

echo "Backup created: $archive"
echo "Size: $(du -h "$archive" | cut -f1)"
