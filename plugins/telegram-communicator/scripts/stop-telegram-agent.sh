#!/usr/bin/env bash
set -euo pipefail

pid_file="${TELEGRAM_AGENT_PID_FILE:-$HOME/.codex/telegram-agent.pid}"

if [ ! -f "$pid_file" ]; then
  echo "telegram-agent is not running"
  exit 0
fi

pid="$(cat "$pid_file")"
if kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  echo "telegram-agent stopped"
else
  echo "telegram-agent pid file was stale"
fi
rm -f "$pid_file"
