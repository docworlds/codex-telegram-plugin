---
name: telegram-setup
description: Configure the local Telegram Communicator Codex plugin, including bot token, chat ID discovery, env file persistence, and MCP registration checks. Use when the user asks to set up, configure, authenticate, connect, or fix Telegram for Codex.
---

# Telegram Communicator Setup

This skill configures the local Telegram Communicator plugin.

## Procedure

1. Locate the plugin setup script with:

```bash
find "$HOME/plugins" "$HOME/.codex/plugins/cache" -path '*/telegram-communicator/scripts/setup.sh' -type f 2>/dev/null | head -n 1
```

Then run it with `bash`.
2. Do not echo Telegram bot tokens in logs, summaries, or final responses.
3. If `CHAT_ID` is missing, tell the user to send any message to their Telegram bot and press Enter in the setup flow. The script will call Telegram `getUpdates` and save the detected chat ID.
4. Save credentials to `~/.codex/telegram-mcp.env` with file mode `600`.
5. Confirm `codex mcp list` includes `telegram` and that it is enabled.
6. Remind the user to restart Codex after changing credentials.

## Files

- Plugin root: `~/plugins/telegram-communicator` or a Codex plugin cache path
- Env file: `~/.codex/telegram-mcp.env`
- MCP launcher: `scripts/run-mcptelegram.sh`
- Setup script: `scripts/setup.sh`
