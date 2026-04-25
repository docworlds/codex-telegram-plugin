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
const IMAGE_DIR = process.env.TELEGRAM_AGENT_IMAGE_DIR || path.join(os.homedir(), ".codex", "telegram-images");
const MODEL = process.env.TELEGRAM_AGENT_MODEL || "";
const CODEX_GLOBAL_ARGS = (process.env.TELEGRAM_AGENT_CODEX_GLOBAL_ARGS || "--sandbox danger-full-access --ask-for-approval never")
  .split(/\s+/)
  .filter(Boolean);
const CODEX_ARGS = (process.env.TELEGRAM_AGENT_CODEX_ARGS || "--skip-git-repo-check")
  .split(/\s+/)
  .filter(Boolean);

if (!TELEGRAM_TOKEN || !CHAT_ID) {
  console.error("TELEGRAM_TOKEN and CHAT_ID are required.");
  process.exit(1);
}

let busy = false;
let stateMtimeMs = 0;
let state = loadState();
let currentTask = null;

function loadState() {
  try {
    const stat = fs.statSync(STATE_FILE);
    stateMtimeMs = stat.mtimeMs;
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { offset: 0, workdir: WORKDIR };
  }
}

function reloadState() {
  try {
    const stat = fs.statSync(STATE_FILE);
    if (stat.mtimeMs <= stateMtimeMs) {
      return;
    }
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    stateMtimeMs = stat.mtimeMs;
  } catch {
    state = { ...state, offset: state.offset || 0, workdir: state.workdir || WORKDIR };
  }
}

function saveState() {
  let latest = {};
  let latestMtimeMs = 0;
  try {
    latestMtimeMs = fs.statSync(STATE_FILE).mtimeMs;
    latest = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  if (latestMtimeMs > stateMtimeMs) {
    state.sessions = latest.sessions || state.sessions;
    state.activeSessionId = latest.activeSessionId || state.activeSessionId;
    state.sessionId = latest.sessionId || state.sessionId;
    state.workdir = latest.workdir || state.workdir || WORKDIR;
  } else {
    state.sessions = state.sessions || latest.sessions;
    state.activeSessionId = state.activeSessionId || latest.activeSessionId;
    state.sessionId = state.sessionId || latest.sessionId;
    state.workdir = state.workdir || latest.workdir || WORKDIR;
  }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  try {
    stateMtimeMs = fs.statSync(STATE_FILE).mtimeMs;
  } catch {}
}

function curl(args, options = {}) {
  return new Promise((resolve, reject) => {
    const safeArgs = [];
    let configFile = null;
    for (const arg of args) {
      if (typeof arg === "string" && arg.includes(TELEGRAM_TOKEN)) {
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

function imageRefsFromMessage(message) {
  const refs = [];
  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = message.photo.reduce((best, item) => {
      const bestScore = (best.file_size || 0) || ((best.width || 0) * (best.height || 0));
      const itemScore = (item.file_size || 0) || ((item.width || 0) * (item.height || 0));
      return itemScore > bestScore ? item : best;
    }, message.photo[0]);
    refs.push({ fileId: photo.file_id, fileName: `telegram-photo-${message.message_id}.jpg`, source: "photo" });
  }

  const document = message.document;
  if (document && isImageDocument(document)) {
    refs.push({
      fileId: document.file_id,
      fileName: document.file_name || `telegram-image-${message.message_id}`,
      source: "document",
    });
  }
  return refs.filter((ref) => ref.fileId);
}

function isImageDocument(document) {
  if (document.mime_type && document.mime_type.startsWith("image/")) {
    return true;
  }
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(document.file_name || "");
}

async function downloadMessageImages(message) {
  const refs = imageRefsFromMessage(message);
  const downloads = [];
  for (let index = 0; index < refs.length; index += 1) {
    downloads.push(await downloadTelegramImage(refs[index], message, index));
  }
  return downloads;
}

async function downloadTelegramImage(ref, message, index) {
  const file = await telegram("getFile", { file_id: ref.fileId }, { maxTime: 30 });
  if (!file || !file.file_path) {
    throw new Error(`Telegram file path not found for ${ref.source}`);
  }

  fs.mkdirSync(IMAGE_DIR, { recursive: true, mode: 0o700 });
  const ext = imageExtension(file.file_path, ref.fileName);
  const base = sanitizeFileBase(path.basename(ref.fileName || ref.source, path.extname(ref.fileName || ""))) || ref.source;
  const filename = `${Date.now()}-${message.message_id}-${index + 1}-${base}${ext}`;
  const destination = path.join(IMAGE_DIR, filename);
  await curl([
    "-o", destination,
    `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`,
  ], { maxTime: 120, maxBuffer: 1024 * 1024 });
  try {
    fs.chmodSync(destination, 0o600);
  } catch {}
  return destination;
}

function imageExtension(...values) {
  for (const value of values) {
    const ext = path.extname(String(value || "")).toLowerCase();
    if (/^\.(avif|bmp|gif|heic|heif|jpeg|jpg|png|tif|tiff|webp)$/.test(ext)) {
      return ext;
    }
  }
  return ".jpg";
}

function sanitizeFileBase(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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
    return "등록된 Codex 세션이 없습니다. 연결할 Codex 세션에서 /telegram-bind를 실행하세요.";
  }
  const active = activeSession();
  return [
    "등록된 Codex 세션:",
    "",
    ...sessions.map((session, index) => `${active && active.id === session.id ? "*" : " "} ${sessionLabel(session, index)}\n   ${session.workdir || ""}`),
    "",
    "새 Codex 세션에서 /telegram-bind를 실행하면 기존 바인딩은 자동으로 교체됩니다.",
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
    "/status - 상태 및 현재 작업 확인",
    "/pwd - 현재 작업 디렉터리",
    "/cd <path> - 작업 디렉터리 변경",
    "/args - Codex 실행 인자 확인",
    "/session - 바인딩된 Codex 세션 확인",
    "/sessions - 현재 등록된 단일 세션 확인",
    "/where - 현재 활성 세션 확인",
    "",
    "이미지를 보내면 caption 텍스트와 함께 Codex에 첨부합니다.",
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

  const text = (message.text || message.caption || "").trim();
  const imageRefs = imageRefsFromMessage(message);
  const hasImages = imageRefs.length > 0;
  if (!text && !hasImages) {
    await sendMessage("텍스트나 이미지 메시지만 처리할 수 있습니다.", message.message_id);
    return;
  }

  if (!hasImages && (text === "/start" || text === "/help")) {
    await sendMessage(helpText(), message.message_id);
    return;
  }

  if (!hasImages && text === "/status") {
    const session = activeSession();
    await sendMessage(formatStatus(session), message.message_id);
    return;
  }

  if (!hasImages && (text === "/session" || text === "/where")) {
    const session = activeSession();
    await sendMessage(session ? `활성 세션:\n${session.label || ""}\n${session.id}\n${session.workdir || ""}` : "활성 Codex 세션이 없습니다.", message.message_id);
    return;
  }

  if (!hasImages && text === "/sessions") {
    await sendMessageWithOptions(sessionsText(), {
      replyTo: message.message_id,
      replyMarkup: sessionsKeyboard(),
    });
    return;
  }

  if (!hasImages && text === "/pwd") {
    await sendMessage(state.workdir || WORKDIR, message.message_id);
    return;
  }

  if (!hasImages && text === "/args") {
    await sendMessage([
      `global: ${CODEX_GLOBAL_ARGS.join(" ") || "(none)"}`,
      `exec: ${CODEX_ARGS.join(" ") || "(none)"}`,
    ].join("\n"), message.message_id);
    return;
  }

  if (!hasImages && text.startsWith("/cd ")) {
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

  let imagePaths = [];
  try {
    imagePaths = await downloadMessageImages(message);
  } catch (error) {
    await sendMessage(`이미지 다운로드 실패:\n${error.message}`, message.message_id);
    return;
  }

  const prompt = buildPrompt(text, imagePaths);
  busy = true;
  currentTask = {
    prompt,
    images: imagePaths,
    startedAt: Date.now(),
    session: activeSession(),
    activity: "Codex 시작 중",
    detail: "",
    lastEventAt: Date.now(),
    lastNotifiedActivity: "",
  };
  await sendMessage(imagePaths.length ? `이미지 ${imagePaths.length}개를 첨부해 Codex 작업을 시작합니다.` : "Codex 작업을 시작합니다.", message.message_id);
  try {
    const answer = await runCodex(prompt, imagePaths);
    await sendMessage(answer, message.message_id);
  } catch (error) {
    await sendMessage(`Codex 실행 실패:\n${error.message}`, message.message_id);
  } finally {
    busy = false;
    currentTask = null;
  }
}

function buildPrompt(text, imagePaths) {
  if (!imagePaths.length) {
    return text;
  }
  const lines = [
    text || "Telegram으로 받은 이미지를 확인하고 답변해 주세요.",
    "",
    "첨부 이미지 경로:",
    ...imagePaths.map((imagePath) => `- ${imagePath}`),
  ];
  return lines.join("\n");
}

function formatStatus(session) {
  if (!busy || !currentTask) {
    return [
      "Codex 대기 중",
      `ready=true`,
      `session=${session ? session.id : "(not bound)"}`,
      `label=${session ? session.label || "" : ""}`,
      `workdir=${session ? session.workdir || "" : state.workdir || WORKDIR}`,
      `model=${MODEL || "config default"}`,
    ].join("\n");
  }

  return [
    "Codex 작업 진행 중",
    `경과: ${formatElapsed(Date.now() - currentTask.startedAt)}`,
    `현재: ${currentTask.activity || "작업 중"}`,
    currentTask.detail ? `파일/명령: ${truncate(currentTask.detail, 160)}` : null,
    `세션: ${currentTask.session ? `${currentTask.session.label || ""} (${currentTask.session.id.slice(0, 8)})` : "(not bound)"}`,
    `작업: "${truncate(currentTask.prompt, 180)}"`,
    `최근 활동: ${formatElapsed(Date.now() - currentTask.lastEventAt)} 전`,
  ].filter(Boolean).join("\n");
}

function formatActivityTransition() {
  if (!currentTask) {
    return "";
  }
  return [
    "Codex 작업 전환",
    `경과: ${formatElapsed(Date.now() - currentTask.startedAt)}`,
    `현재: ${currentTask.activity || "작업 중"}`,
    currentTask.detail ? `파일/명령: ${truncate(currentTask.detail, 160)}` : null,
    `작업: "${truncate(currentTask.prompt, 180)}"`,
  ].filter(Boolean).join("\n");
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}초`;
  }
  return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`;
}

function truncate(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function updateActivity(activity, detail) {
  if (!currentTask) {
    return;
  }
  const previousActivity = currentTask.activity;
  currentTask.activity = activity || currentTask.activity;
  currentTask.detail = detail || currentTask.detail || "";
  currentTask.lastEventAt = Date.now();
  maybeNotifyActivityTransition(previousActivity);
}

function maybeNotifyActivityTransition(previousActivity) {
  if (!currentTask || !currentTask.activity) {
    return;
  }
  if (currentTask.activity === previousActivity || currentTask.activity === currentTask.lastNotifiedActivity) {
    return;
  }
  if (!isMajorActivity(currentTask.activity)) {
    return;
  }
  currentTask.lastNotifiedActivity = currentTask.activity;
  sendMessage(formatActivityTransition()).catch((error) => {
    console.error(`activity transition notification failed: ${error.message}`);
  });
}

function isMajorActivity(activity) {
  return [
    "작업 준비 중",
    "명령 실행 중",
    "웹 검색 중",
    "파일 수정 중",
    "모델 응답 생성 중",
    "최종 응답 정리 중",
  ].includes(activity);
}

function handleCodexEvent(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }

  const type = event.type || event.msg || event.event;
  const payload = event.payload || event;
  if (type === "exec_command_begin" || type === "ExecCommandBegin") {
    const cmd = payload.command || payload.cmd || payload.parsed_cmd;
    updateActivity("명령 실행 중", Array.isArray(cmd) ? cmd.join(" ") : JSON.stringify(cmd || ""));
    return true;
  }
  if (type === "exec_command_end" || type === "ExecCommandEnd") {
    const cmd = payload.command || payload.cmd || payload.parsed_cmd;
    const status = payload.exit_code === 0 || payload.status === "completed" ? "명령 완료" : "명령 종료";
    updateActivity(status, Array.isArray(cmd) ? cmd.join(" ") : JSON.stringify(cmd || ""));
    return true;
  }
  if (type === "web_search_begin" || type === "WebSearchBegin") {
    updateActivity("웹 검색 중", JSON.stringify(payload.query || payload.queries || ""));
    return true;
  }
  if (type === "web_search_end" || type === "WebSearchEnd") {
    updateActivity("웹 검색 완료", JSON.stringify(payload.query || payload.queries || ""));
    return true;
  }
  if (type === "patch_apply_begin" || type === "PatchApplyBegin") {
    updateActivity("파일 수정 중", "apply_patch");
    return true;
  }
  if (type === "patch_apply_end" || type === "PatchApplyEnd") {
    updateActivity("파일 수정 완료", "apply_patch");
    return true;
  }
  if (type === "agent_message_delta" || type === "AgentMessageDelta" || type === "agent_message" || type === "AgentMessage") {
    updateActivity("모델 응답 생성 중", "");
    return true;
  }
  if (type === "turn_started" || type === "TurnStarted") {
    updateActivity("작업 준비 중", "");
    return true;
  }
  if (type === "turn_complete" || type === "TurnComplete") {
    updateActivity("최종 응답 정리 중", "");
    return true;
  }
  return false;
}

function runCodex(prompt, imagePaths = []) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(os.tmpdir(), `telegram-codex-${Date.now()}.txt`);
    const session = activeSession();
    const imageArgs = imagePaths.flatMap((imagePath) => ["--image", imagePath]);
    const execArgs = [...CODEX_ARGS, "--json", "-o", outputFile, ...imageArgs];
    if (MODEL) {
      execArgs.push("-m", MODEL);
    }
    const args = session
      ? [...CODEX_GLOBAL_ARGS, "exec", "resume", ...execArgs, session.id]
      : [...CODEX_GLOBAL_ARGS, "exec", ...execArgs, "-C", state.workdir || WORKDIR];
    args.push("-");

    const child = spawn("codex", args, {
      cwd: state.workdir || WORKDIR,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          handleCodexEvent(line);
        }
      }
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
      reloadState();
      const updates = await getUpdates();
      reloadState();
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
