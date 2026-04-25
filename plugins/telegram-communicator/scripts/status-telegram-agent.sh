#!/usr/bin/env bash
set -euo pipefail

pid_file="${TELEGRAM_AGENT_PID_FILE:-$HOME/.codex/telegram-agent.pid}"

if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "telegram-agent running with pid $(cat "$pid_file")"
else
  echo "telegram-agent not running"
fi
