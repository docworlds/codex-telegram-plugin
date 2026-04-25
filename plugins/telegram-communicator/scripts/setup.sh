#!/usr/bin/env bash
set -euo pipefail

env_file="${TELEGRAM_MCP_ENV_FILE:-$HOME/.codex/telegram-mcp.env}"
current_token="${TELEGRAM_TOKEN:-}"
current_chat_id="${CHAT_ID:-}"

if [ -f "$env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
  current_token="${TELEGRAM_TOKEN:-}"
  current_chat_id="${CHAT_ID:-}"
fi

mask_token() {
  local value="$1"
  if [ "${#value}" -le 10 ]; then
    printf 'configured'
  else
    printf '%s...%s' "${value:0:6}" "${value: -4}"
  fi
}

prompt_token() {
  local answer token
  if [ -n "$current_token" ]; then
    read -r -p "Existing TELEGRAM_TOKEN found ($(mask_token "$current_token")). Keep it? [Y/n] " answer
    case "$answer" in
      n|N|no|NO) ;;
      *) TELEGRAM_TOKEN="$current_token"; return ;;
    esac
  fi

  while true; do
    read -r -s -p "Enter Telegram bot token from BotFather: " token
    printf '\n'
    if [ -n "$token" ]; then
      TELEGRAM_TOKEN="$token"
      return
    fi
    echo "Token cannot be empty."
  done
}

discover_chat_id() {
  node <<'NODE'
const https = require("https");
const token = process.env.TELEGRAM_TOKEN;
const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=5&limit=20`;

https
  .get(url, (res) => {
    let body = "";
    res.on("data", (chunk) => {
      body += chunk;
    });
    res.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        if (!parsed.ok) {
          console.error(parsed.description || "Telegram API returned an error.");
          process.exit(1);
        }

        const updates = Array.isArray(parsed.result) ? parsed.result.slice().reverse() : [];
        for (const update of updates) {
          const message =
            update.message ||
            update.channel_post ||
            update.edited_message ||
            update.edited_channel_post;
          if (message && message.chat && message.chat.id) {
            console.log(String(message.chat.id));
            return;
          }
        }
        process.exit(2);
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
    });
  })
  .on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
NODE
}

prompt_chat_id() {
  local answer chat_id discovered
  if [ -n "$current_chat_id" ]; then
    read -r -p "Existing CHAT_ID found ($current_chat_id). Keep it? [Y/n] " answer
    case "$answer" in
      n|N|no|NO) ;;
      *) CHAT_ID="$current_chat_id"; return ;;
    esac
  fi

  read -r -p "If you already know CHAT_ID, enter it now. Otherwise press Enter to auto-detect: " chat_id
  if [ -n "$chat_id" ]; then
    CHAT_ID="$chat_id"
    return
  fi

  echo "Open Telegram, send any message to your bot, then press Enter here."
  while true; do
    read -r -p "Press Enter after sending the message, or type CHAT_ID manually: " chat_id
    if [ -n "$chat_id" ]; then
      CHAT_ID="$chat_id"
      return
    fi

    set +e
    discovered="$(TELEGRAM_TOKEN="$TELEGRAM_TOKEN" discover_chat_id 2>/tmp/telegram-mcp-setup.err)"
    status=$?
    set -e

    if [ "$status" -eq 0 ] && [ -n "$discovered" ]; then
      CHAT_ID="$discovered"
      echo "Detected CHAT_ID: $CHAT_ID"
      return
    fi

    if [ "$status" -eq 2 ]; then
      echo "No Telegram message found yet. Send a message to the bot and try again."
    else
      echo "Could not read Telegram updates: $(cat /tmp/telegram-mcp-setup.err)"
    fi
  done
}

write_env() {
  mkdir -p "$(dirname "$env_file")"
  umask 077
  {
    printf 'TELEGRAM_TOKEN=%q\n' "$TELEGRAM_TOKEN"
    printf 'CHAT_ID=%q\n' "$CHAT_ID"
  } > "$env_file"
  chmod 600 "$env_file"
}

prompt_token
prompt_chat_id
write_env

echo "Saved Telegram MCP settings to $env_file"
echo "Restart Codex to load the Telegram MCP server."
