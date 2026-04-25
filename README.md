# Codex Telegram Plugin

Local Codex plugin marketplace for `telegram-communicator`.

The plugin adds a Telegram MCP server to Codex and provides `/telegram-setup` to configure:

- Telegram bot token from BotFather
- Telegram chat ID discovery
- `~/.codex/telegram-mcp.env` persistence with `600` permissions

## Install

Add this marketplace to Codex:

```bash
codex plugin marketplace add docworlds/codex-telegram-plugin
```

Enable the plugin in `~/.codex/config.toml`:

```toml
[plugins."telegram-communicator@codex-telegram-plugin"]
enabled = true
```

Restart Codex, then run:

```text
/telegram-setup
```

## Manual Local Install

If you cloned this repository locally:

```bash
git clone git@github.com:docworlds/codex-telegram-plugin.git
codex plugin marketplace add ./codex-telegram-plugin
```

Then enable:

```toml
[plugins."telegram-communicator@codex-telegram-plugin"]
enabled = true
```

Restart Codex and run `/telegram-setup`.

## Requirements

- Codex CLI with plugin marketplace support
- Node.js and `npx` available on PATH
- Telegram bot token from `@BotFather`

## Files

- Plugin manifest: `plugins/telegram-communicator/.codex-plugin/plugin.json`
- MCP server config: `plugins/telegram-communicator/.mcp.json`
- Setup command: `plugins/telegram-communicator/commands/telegram-setup.md`
- Setup script: `plugins/telegram-communicator/scripts/setup.sh`
