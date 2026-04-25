#!/usr/bin/env bash
set -euo pipefail

env_file="${TELEGRAM_MCP_ENV_FILE:-$HOME/.codex/telegram-mcp.env}"

if [ -f "$env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
fi

if [ -z "${TELEGRAM_TOKEN:-}" ]; then
  if [ -t 0 ] && [ -t 1 ]; then
    exec "$(dirname "$0")/setup.sh"
  fi
  echo "TELEGRAM_TOKEN is not set. Run /home/wingu/plugins/telegram-communicator/scripts/setup.sh first." >&2
  exit 1
fi

if [ -z "${CHAT_ID:-}" ]; then
  if [ -t 0 ] && [ -t 1 ]; then
    exec "$(dirname "$0")/setup.sh"
  fi
  echo "CHAT_ID is not set. Run /home/wingu/plugins/telegram-communicator/scripts/setup.sh first." >&2
  exit 1
fi

if command -v mcptelegram >/dev/null 2>&1; then
  exec mcptelegram
fi

node_bin="$(find "$HOME/.nvm/versions/node" -path '*/bin/mcptelegram' -type f -executable 2>/dev/null | sort -V | tail -n 1 || true)"
[ -n "$node_bin" ] && exec "$node_bin"

exec npx -y @mseep/mcp-communicator-telegram
