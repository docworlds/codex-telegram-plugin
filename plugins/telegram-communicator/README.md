# Telegram Communicator for Codex

This local Codex plugin starts `@mseep/mcp-communicator-telegram` as an MCP server.

## Setup

In Codex, run the plugin command:

```text
/telegram-setup
```

Create a Telegram bot with BotFather when prompted.

For manual local development, the same setup script is available as:

```bash
~/plugins/telegram-communicator/scripts/setup.sh
```

The setup writes credentials to:

```bash
~/.codex/telegram-mcp.env
```

Expected content:

```bash
TELEGRAM_TOKEN=your_bot_token_here
CHAT_ID=your_chat_id_here
```

To discover `CHAT_ID` manually, set `TELEGRAM_TOKEN` first and run:

```bash
/home/wingu/plugins/telegram-communicator/scripts/get-chat-id.sh
```

Then send a message to your bot and copy the printed chat ID.
