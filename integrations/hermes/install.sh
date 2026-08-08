#!/usr/bin/env bash
set -euo pipefail

HERMES_PATH="${1:-${HERMES_HOME:-$HOME/.hermes}/hermes-agent}"
VAULT_URL="${ARKAN_VAULT_URL:-https://arkan-server.tail9b08be.ts.net}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HERMES_HOME_PATH="${HERMES_HOME:-$(dirname "$HERMES_PATH")}" 

if [[ ! -f "$HERMES_PATH/agent/memory_provider.py" ]]; then
  echo "Hermes checkout not found at: $HERMES_PATH" >&2
  exit 1
fi

TARGET="$HERMES_PATH/plugins/memory/arkan"
mkdir -p "$TARGET" "$HERMES_HOME_PATH"
cp "$SCRIPT_DIR/plugins/memory/arkan/__init__.py" "$TARGET/__init__.py"

ENV_FILE="$HERMES_HOME_PATH/.env"
touch "$ENV_FILE"
upsert_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}
upsert_env ARKAN_VAULT_URL "$VAULT_URL"
upsert_env ARKAN_VAULT_SDK_PATH "$VAULT_ROOT/sdk/python"

HERMES_BIN="$HERMES_PATH/venv/bin/hermes"
if [[ -x "$HERMES_BIN" ]]; then
  "$HERMES_BIN" config set memory.provider arkan
elif command -v hermes >/dev/null 2>&1; then
  hermes config set memory.provider arkan
else
  echo "Provider copied, but the hermes command was not found; set memory.provider=arkan manually." >&2
  exit 1
fi

echo "Arkan provider installed and activated."
echo "Vault: $VAULT_URL"
