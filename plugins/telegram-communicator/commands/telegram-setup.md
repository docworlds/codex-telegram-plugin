---
description: Configure the Telegram Communicator plugin by collecting bot token and chat ID, then writing ~/.codex/telegram-mcp.env.
---

# Telegram Communicator Setup

Run the setup flow for the local Telegram Communicator plugin.

## Rules

- Never print or summarize the Telegram bot token.
- Store credentials only in `~/.codex/telegram-mcp.env`.
- Write the env file with permission `600`.
- If a token already exists, ask whether to keep it.
- If `CHAT_ID` is unknown, guide the user to send a message to their Telegram bot, then auto-detect it via Telegram `getUpdates`.
- If auto-detection fails, ask for `CHAT_ID` manually.
- After saving, verify `codex mcp list` shows the `telegram` MCP server enabled.

## Flow

1. Explain that the user needs a bot token from `@BotFather`.
2. Run the interactive setup script in a TTY:

```bash
setup_script="$(find "$HOME/plugins" "$HOME/.codex/plugins/cache" -path '*/telegram-communicator/scripts/setup.sh' -type f 2>/dev/null | head -n 1)"
if [ -z "$setup_script" ]; then
  echo "Could not find telegram-communicator setup.sh. Reinstall the plugin marketplace and restart Codex." >&2
  exit 1
fi
bash "$setup_script"
```

3. If the terminal prompt needs user input, ask the user for the value in chat only when there is no safer terminal input path. Do not repeat secret values back.
4. When complete, tell the user to restart Codex so the MCP server reloads with the new credentials.

## Verification

Run:

```bash
codex mcp list
```

Expected: `telegram` is present and `enabled`.
