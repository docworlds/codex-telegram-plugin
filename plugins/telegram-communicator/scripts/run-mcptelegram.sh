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
  echo "TELEGRAM_TOKEN is not set. Run $(dirname "$0")/setup.sh first." >&2
  exit 1
fi

if [ -z "${CHAT_ID:-}" ]; then
  if [ -t 0 ] && [ -t 1 ]; then
    exec "$(dirname "$0")/setup.sh"
  fi
  echo "CHAT_ID is not set. Run $(dirname "$0")/setup.sh first." >&2
  exit 1
fi

exec node "$(dirname "$0")/mcptelegram-local.js"
