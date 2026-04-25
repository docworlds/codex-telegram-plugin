#!/usr/bin/env bash
set -euo pipefail

env_file="${TELEGRAM_MCP_ENV_FILE:-$HOME/.codex/telegram-mcp.env}"
pid_file="${TELEGRAM_AGENT_PID_FILE:-$HOME/.codex/telegram-agent.pid}"
log_file="${TELEGRAM_AGENT_LOG_FILE:-$HOME/.codex/telegram-agent.log}"

if [ -f "$env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
fi

if [ -z "${TELEGRAM_TOKEN:-}" ] || [ -z "${CHAT_ID:-}" ]; then
  echo "Telegram is not configured. Run /telegram-setup first." >&2
  exit 1
fi

if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "telegram-agent already running with pid $(cat "$pid_file")"
  exit 0
fi

mkdir -p "$(dirname "$pid_file")"
node_bin="$(command -v node)"
setsid "$node_bin" "$(dirname "$0")/telegram-agent.js" </dev/null >>"$log_file" 2>&1 &
echo "$!" > "$pid_file"
chmod 600 "$pid_file" "$log_file" 2>/dev/null || true
echo "telegram-agent started with pid $(cat "$pid_file")"
