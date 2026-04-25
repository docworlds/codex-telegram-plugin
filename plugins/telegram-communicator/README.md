# Telegram Communicator for Codex

This local Codex plugin provides two Telegram integrations:

- a Codex MCP server for outbound notifications, questions, and file sharing
- an optional local bridge daemon that lets you send a Telegram message to the bot and receive a `codex exec` response

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
~/plugins/telegram-communicator/scripts/get-chat-id.sh
```

Then send a message to your bot and copy the printed chat ID.

## Remote Control Bridge

Start the bridge:

```bash
~/plugins/telegram-communicator/scripts/start-telegram-agent.sh
```

Stop it:

```bash
~/plugins/telegram-communicator/scripts/stop-telegram-agent.sh
```

Check status:

```bash
~/plugins/telegram-communicator/scripts/status-telegram-agent.sh
```

Once running, send a text message to your bot. The bridge only accepts messages from the configured `CHAT_ID`, runs:

```bash
codex exec resume "$BOUND_CODEX_SESSION_ID" --full-auto --skip-git-repo-check -
```

and replies with the final Codex response.

Bind the currently open Codex session before using Telegram remote prompts.

In Codex TUI, send this as a normal message, without a leading slash:

```text
telegram-bind
```

Codex currently treats unknown `/...` input as built-in slash commands before plugin or skill handling, so `/telegram-bind` is not supported in the TUI. You can also run the shell helper manually:

```bash
telegram-bind
```

Only one Codex session is bound at a time. Binding a new session replaces the previous binding.

The bridge uses `CODEX_THREAD_ID` when available. If you are binding from outside Codex, pass the session id manually:

```bash
~/plugins/telegram-communicator/scripts/bind-current-session.sh 019dc221-...
```

Telegram commands:

- `/help` shows usage
- `/status` shows bridge state
- `/pwd` shows the active working directory
- `/cd <path>` changes the working directory
- `/args` shows the Codex exec arguments
- `/session` shows the bound Codex session id
- `/sessions` shows the currently registered session
- `/where` shows the active session

Optional env values can be added to `~/.codex/telegram-mcp.env`:

```bash
TELEGRAM_AGENT_WORKDIR=/path/to/project
TELEGRAM_AGENT_MODEL=gpt-5.5
TELEGRAM_AGENT_CODEX_ARGS="--full-auto --skip-git-repo-check"
```
