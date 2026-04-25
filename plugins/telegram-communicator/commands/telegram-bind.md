---
description: Bind the current Codex session as the only Telegram-controlled session.
---

# Telegram Session Bind

Register the current Codex session for Telegram remote prompts. This replaces any previously bound session.

## Flow

Run:

```bash
bind_script="$(find "$HOME/plugins" "$HOME/.codex/plugins/cache" -path '*/telegram-communicator/scripts/bind-current-session.sh' -type f 2>/dev/null | head -n 1)"
if [ -z "$bind_script" ]; then
  echo "Could not find telegram-communicator bind-current-session.sh. Reinstall the plugin marketplace and restart Codex." >&2
  exit 1
fi
bash "$bind_script"
start_script="$(dirname "$bind_script")/start-telegram-agent.sh"
if [ -x "$start_script" ]; then
  bash "$start_script"
fi
```

Then tell the user this session is now the only Telegram-bound Codex session. In Telegram, `/where` shows the bound session and `/status` shows bridge status.
