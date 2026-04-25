#!/usr/bin/env bash
set -euo pipefail

state_file="${TELEGRAM_AGENT_STATE_FILE:-$HOME/.codex/telegram-agent-state.json}"
session_id="${1:-${CODEX_THREAD_ID:-}}"
workdir="${2:-$PWD}"

if [ -z "$session_id" ]; then
  echo "Could not detect CODEX_THREAD_ID. Run this from inside the Codex session you want to bind, or pass a session id." >&2
  exit 1
fi

mkdir -p "$(dirname "$state_file")"
label="${TELEGRAM_SESSION_LABEL:-${3:-}}"
if [ -z "$label" ]; then
  label="$(basename "$workdir")"
fi

STATE_FILE="$state_file" SESSION_ID="$session_id" WORKDIR="$workdir" LABEL="$label" node <<'NODE'
const fs = require("fs");
const stateFile = process.env.STATE_FILE;
let state = {};
try {
  state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
} catch {}
const now = new Date().toISOString();
const session = {
  id: process.env.SESSION_ID,
  workdir: process.env.WORKDIR,
  label: process.env.LABEL || process.env.SESSION_ID,
  updatedAt: now,
};
state.sessions = [session];
state.activeSessionId = session.id;
state.sessionId = session.id;
state.workdir = process.env.WORKDIR;
state.mode = "resume";
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
NODE

chmod 600 "$state_file"
echo "Bound Telegram agent to Codex session $session_id ($label) in $workdir"
