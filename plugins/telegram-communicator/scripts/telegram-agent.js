#!/usr/bin/env node
"use strict";

const { execFile, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = String(process.env.CHAT_ID || "");
const STATE_FILE = process.env.TELEGRAM_AGENT_STATE_FILE || path.join(os.homedir(), ".codex", "telegram-agent-state.json");
const WORKDIR = process.env.TELEGRAM_AGENT_WORKDIR || os.homedir();
const MODEL = process.env.TELEGRAM_AGENT_MODEL || "";
const CODEX_ARGS = (process.env.TELEGRAM_AGENT_CODEX_ARGS || "--full-auto --skip-git-repo-check")
  .split(/\s+/)
  .filter(Boolean);

if (!TELEGRAM_TOKEN || !CHAT_ID) {
  console.error("TELEGRAM_TOKEN and CHAT_ID are required.");
  process.exit(1);
}

let busy = false;
let state = loadState();

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { offset: 0, workdir: WORKDIR };
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function curl(args, options = {}) {
  return new Promise((resolve, reject) => {
    const safeArgs = [];
    let configFile = null;
    for (const arg of args) {
      if (typeof arg === "string" && arg.startsWith("https://api.telegram.org/bot")) {
        configFile = path.join(os.tmpdir(), `telegram-curl-${process.pid}-${Date.now()}.conf`);
        fs.writeFileSync(configFile, `url = "${arg.replace(/"/g, '\\"')}"\n`, { mode: 0o600 });
        safeArgs.push("--config", configFile);
      } else {
        safeArgs.push(arg);
      }
    }

    execFile("curl", ["-fsS", "--connect-timeout", "10", "--max-time", String(options.maxTime || 30), ...safeArgs], {
      maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (configFile) {
        try {
          fs.unlinkSync(configFile);
        } catch {}
      }
      if (error) {
        reject(new Error((stderr || error.message || "curl failed").trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function apiUrl(method) {
  return `https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`;
}

async function telegram(method, fields = {}, options = {}) {
  const args = ["-X", "POST"];
  for (const [key, value] of Object.entries(fields)) {
    args.push("--data-urlencode", `${key}=${value}`);
  }
  args.push(apiUrl(method));
  const raw = await curl(args, options);
  const parsed = JSON.parse(raw);
  if (!parsed.ok) {
    throw new Error(parsed.description || `Telegram ${method} failed`);
  }
  return parsed.result;
}

async function telegramMultipart(method, fields = {}, options = {}) {
  const args = ["-X", "POST"];
  for (const [key, value] of Object.entries(fields)) {
    args.push("-F", `${key}=${value}`);
  }
  args.push(apiUrl(method));
  const raw = await curl(args, options);
  const parsed = JSON.parse(raw);
  if (!parsed.ok) {
    throw new Error(parsed.description || `Telegram ${method} failed`);
  }
  return parsed.result;
}

async function getUpdates() {
  return telegram("getUpdates", {
    timeout: "20",
    limit: "20",
    offset: String(state.offset || 0),
  }, { maxTime: 35 });
}

async function sendMessage(text, replyTo) {
  return sendMessageWithOptions(text, { replyTo });
}

async function sendMessageWithOptions(text, options = {}) {
  const chunks = splitMessage(text || "(empty)");
  for (const chunk of chunks) {
    const payload = { chat_id: CHAT_ID, text: chunk };
    if (options.replyTo) {
      payload.reply_to_message_id = String(options.replyTo);
    }
    if (options.replyMarkup) {
      payload.reply_markup = JSON.stringify(options.replyMarkup);
    }
    await telegram("sendMessage", payload, { maxTime: 30 });
  }
}

function splitMessage(text) {
  const limit = 3900;
  const chunks = [];
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.slice(i, i + limit));
  }
  return chunks.length ? chunks : [text];
}

function messageFromUpdate(update) {
  return update.message || update.edited_message || null;
}

function activeSession() {
  const id = state.activeSessionId || state.sessionId;
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  return sessions.find((session) => session && session.id === id) || (id ? { id, workdir: state.workdir || WORKDIR, label: id } : null);
}

function sessionLabel(session, index) {
  const label = session.label || path.basename(session.workdir || "") || session.id;
  const shortId = session.id.slice(0, 8);
  return `${index + 1}. ${label} (${shortId})`;
}

function sessionsText() {
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  if (!sessions.length) {
    return "등록된 Codex 세션이 없습니다. 연결할 Codex 세션 안에서 bind-current-session.sh를 실행하세요.";
  }
  const active = activeSession();
  return [
    "등록된 Codex 세션:",
    "",
    ...sessions.map((session, index) => `${active && active.id === session.id ? "*" : " "} ${sessionLabel(session, index)}\n   ${session.workdir || ""}`),
    "",
    "아래 버튼을 눌러 활성 세션을 선택하세요.",
  ].join("\n");
}

function sessionsKeyboard() {
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  return {
    inline_keyboard: sessions.map((session, index) => ([{
      text: sessionLabel(session, index).slice(0, 60),
      callback_data: `use:${session.id}`,
    }])),
  };
}

function helpText() {
  return [
    "Codex Telegram bridge",
    "",
    "그냥 메시지를 보내면 바인딩된 Codex 세션으로 전달하고 결과를 답장합니다.",
    "",
    "Commands:",
    "/help - 도움말",
    "/status - 상태 확인",
    "/pwd - 현재 작업 디렉터리",
    "/cd <path> - 작업 디렉터리 변경",
    "/args - Codex 실행 인자 확인",
    "/session - 바인딩된 Codex 세션 확인",
    "/sessions - 등록된 세션 버튼 목록",
    "/use <번호|sessionId> - 활성 세션 선택",
    "/where - 현재 활성 세션 확인",
  ].join("\n");
}

async function handleCallback(callbackQuery) {
  if (!callbackQuery || !callbackQuery.message || String(callbackQuery.message.chat.id) !== CHAT_ID) {
    return;
  }
  const data = callbackQuery.data || "";
  if (!data.startsWith("use:")) {
    return;
  }
  const sessionId = data.slice(4);
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const session = sessions.find((item) => item && item.id === sessionId);
  if (!session) {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: "세션을 찾을 수 없습니다.",
      show_alert: "true",
    });
    return;
  }
  state.activeSessionId = session.id;
  state.sessionId = session.id;
  state.workdir = session.workdir || state.workdir || WORKDIR;
  saveState();
  await telegram("answerCallbackQuery", {
    callback_query_id: callbackQuery.id,
    text: `선택됨: ${session.label || session.id.slice(0, 8)}`,
  });
  await sendMessage(`활성 세션 변경됨:\n${session.label || session.id}\n${session.id}\n${session.workdir || ""}`, callbackQuery.message.message_id);
}

async function handleMessage(message) {
  if (!message || String(message.chat && message.chat.id) !== CHAT_ID) {
    return;
  }

  const text = (message.text || "").trim();
  if (!text) {
    await sendMessage("텍스트 메시지만 처리할 수 있습니다.", message.message_id);
    return;
  }

  if (text === "/start" || text === "/help") {
    await sendMessage(helpText(), message.message_id);
    return;
  }

  if (text === "/status") {
    const session = activeSession();
    await sendMessage(`ready=${!busy}\nmode=${session ? "resume" : "new-exec"}\nsession=${session ? session.id : "(not bound)"}\nlabel=${session ? session.label || "" : ""}\nworkdir=${session ? session.workdir || "" : state.workdir || WORKDIR}\nmodel=${MODEL || "config default"}`, message.message_id);
    return;
  }

  if (text === "/session" || text === "/where") {
    const session = activeSession();
    await sendMessage(session ? `활성 세션:\n${session.label || ""}\n${session.id}\n${session.workdir || ""}` : "활성 Codex 세션이 없습니다.", message.message_id);
    return;
  }

  if (text === "/sessions") {
    await sendMessageWithOptions(sessionsText(), {
      replyTo: message.message_id,
      replyMarkup: sessionsKeyboard(),
    });
    return;
  }

  if (text.startsWith("/use ")) {
    const query = text.slice(5).trim();
    const sessions = Array.isArray(state.sessions) ? state.sessions : [];
    const byIndex = /^\d+$/.test(query) ? sessions[Number(query) - 1] : null;
    const session = byIndex || sessions.find((item) => item && item.id.startsWith(query));
    if (!session) {
      await sendMessage("세션을 찾을 수 없습니다. /sessions로 목록을 확인하세요.", message.message_id);
      return;
    }
    state.activeSessionId = session.id;
    state.sessionId = session.id;
    state.workdir = session.workdir || state.workdir || WORKDIR;
    saveState();
    await sendMessage(`활성 세션 변경됨:\n${session.label || session.id}\n${session.id}`, message.message_id);
    return;
  }

  if (text === "/pwd") {
    await sendMessage(state.workdir || WORKDIR, message.message_id);
    return;
  }

  if (text === "/args") {
    await sendMessage(CODEX_ARGS.join(" ") || "(none)", message.message_id);
    return;
  }

  if (text.startsWith("/cd ")) {
    const next = path.resolve(state.workdir || WORKDIR, text.slice(4).trim());
    if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) {
      await sendMessage(`디렉터리를 찾을 수 없습니다: ${next}`, message.message_id);
      return;
    }
    state.workdir = next;
    saveState();
    await sendMessage(`작업 디렉터리 변경됨:\n${next}`, message.message_id);
    return;
  }

  if (busy) {
    await sendMessage("이미 Codex 작업이 실행 중입니다. 끝난 뒤 다시 보내주세요.", message.message_id);
    return;
  }

  busy = true;
  await sendMessage("Codex 작업을 시작합니다.", message.message_id);
  try {
    const answer = await runCodex(text);
    await sendMessage(answer, message.message_id);
  } catch (error) {
    await sendMessage(`Codex 실행 실패:\n${error.message}`, message.message_id);
  } finally {
    busy = false;
  }
}

function runCodex(prompt) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(os.tmpdir(), `telegram-codex-${Date.now()}.txt`);
    const session = activeSession();
    const args = session
      ? ["exec", "resume", ...CODEX_ARGS, "-o", outputFile, session.id]
      : ["exec", ...CODEX_ARGS, "-C", state.workdir || WORKDIR, "-o", outputFile];
    if (MODEL) {
      args.push("-m", MODEL);
    }
    args.push("-");

    const child = spawn("codex", args, {
      cwd: state.workdir || WORKDIR,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const finalText = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8").trim() : "";
        if (fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }
        if (code === 0) {
          resolve(finalText || stdout.trim() || "완료됐지만 Codex가 최종 메시지를 남기지 않았습니다.");
        } else {
          reject(new Error((stderr || stdout || `codex exited with code ${code}`).trim()));
        }
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(prompt);
  });
}

async function loop() {
  console.error(`telegram-agent started. chat=${CHAT_ID} workdir=${state.workdir || WORKDIR}`);
  while (true) {
    try {
      const updates = await getUpdates();
      for (const update of updates) {
        if (typeof update.update_id === "number") {
          state.offset = update.update_id + 1;
          saveState();
        }
        if (update.callback_query) {
          await handleCallback(update.callback_query);
          continue;
        }
        await handleMessage(messageFromUpdate(update));
      }
    } catch (error) {
      console.error(`poll error: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

loop().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
