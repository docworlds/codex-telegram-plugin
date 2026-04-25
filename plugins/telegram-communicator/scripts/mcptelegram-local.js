#!/usr/bin/env node
"use strict";

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

if (!TELEGRAM_TOKEN || !CHAT_ID) {
  console.error("TELEGRAM_TOKEN and CHAT_ID are required.");
  process.exit(1);
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
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (configFile) {
        try {
          fs.unlinkSync(configFile);
        } catch {}
      }
      if (error) {
        const message = (stderr || error.message || "curl failed").trim();
        reject(new Error(message));
        return;
      }
      resolve(stdout);
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: options.maxBuffer || 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message || `${command} failed`).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function apiUrl(method) {
  return `https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`;
}

async function telegramJson(method, fields = {}, options = {}) {
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

async function sendMessage(text, extra = {}) {
  return telegramJson("sendMessage", {
    chat_id: CHAT_ID,
    text,
    ...extra,
  });
}

async function getUpdates(offset) {
  const fields = {
    timeout: "10",
    limit: "50",
  };
  if (offset !== undefined) {
    fields.offset = String(offset);
  }
  return telegramJson("getUpdates", fields, { maxTime: 20 });
}

function chatIdFromUpdate(update) {
  const candidates = [
    update.message,
    update.channel_post,
    update.edited_message,
    update.edited_channel_post,
    update.callback_query && update.callback_query.message,
    update.my_chat_member,
    update.chat_member,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.chat && candidate.chat.id !== undefined) {
      return String(candidate.chat.id);
    }
  }
  return null;
}

function textFromUpdate(update) {
  const message = update.message || update.channel_post || update.edited_message || update.edited_channel_post;
  return message && typeof message.text === "string" ? message.text : null;
}

async function askUser({ question }) {
  if (!question) {
    throw new Error("question is required");
  }

  const existing = await getUpdates();
  let offset = 0;
  for (const update of existing) {
    if (typeof update.update_id === "number" && update.update_id >= offset) {
      offset = update.update_id + 1;
    }
  }

  const questionId = Math.random().toString(36).slice(2, 8);
  await sendMessage(`#${questionId}\n${question}`, {
    reply_markup: JSON.stringify({ force_reply: true, selective: true }),
  });

  while (true) {
    const updates = await getUpdates(offset);
    for (const update of updates) {
      if (typeof update.update_id === "number" && update.update_id >= offset) {
        offset = update.update_id + 1;
      }
      if (chatIdFromUpdate(update) !== String(CHAT_ID)) {
        continue;
      }
      const text = textFromUpdate(update);
      if (text) {
        return text;
      }
    }
  }
}

async function notifyUser({ message }) {
  if (!message) {
    throw new Error("message is required");
  }
  await sendMessage(message);
}

async function sendFile({ filePath }) {
  if (!filePath) {
    throw new Error("filePath is required");
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`File not found: ${resolved}`);
  }
  await sendDocument(resolved);
}

async function sendDocument(filePath, caption) {
  const raw = await curl([
    "-X", "POST",
    "-F", `chat_id=${CHAT_ID}`,
    "-F", `document=@${filePath}`,
    ...(caption ? ["-F", `caption=${String(caption).slice(0, 1024)}`] : []),
    apiUrl("sendDocument"),
  ], { maxTime: 120, maxBuffer: 20 * 1024 * 1024 });
  const parsed = JSON.parse(raw);
  if (!parsed.ok) {
    throw new Error(parsed.description || "Telegram sendDocument failed");
  }
}

async function sendImage({ filePath, caption } = {}) {
  if (!filePath) {
    throw new Error("filePath is required");
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`File not found: ${resolved}`);
  }
  if (!isImagePath(resolved)) {
    throw new Error(`Not a supported image file: ${resolved}`);
  }

  const fields = [
    "-X", "POST",
    "-F", `chat_id=${CHAT_ID}`,
    "-F", `photo=@${resolved}`,
  ];
  if (caption) {
    fields.push("-F", `caption=${String(caption).slice(0, 1024)}`);
  }
  try {
    const raw = await curl([...fields, apiUrl("sendPhoto")], { maxTime: 120, maxBuffer: 20 * 1024 * 1024 });
    const parsed = JSON.parse(raw);
    if (!parsed.ok) {
      throw new Error(parsed.description || "Telegram sendPhoto failed");
    }
  } catch {
    await sendDocument(resolved, caption);
  }
}

function isImagePath(filePath) {
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(filePath);
}

async function zipProject({ directory } = {}) {
  const root = path.resolve(directory || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Directory not found: ${root}`);
  }

  const projectName = path.basename(root) || "project";
  const archivePath = path.join(os.tmpdir(), `${projectName}-project-${Date.now()}.tar.gz`);
  try {
    await run("tar", [
      "--exclude=.git",
      "--exclude=node_modules",
      "--exclude=.next",
      "--exclude=dist",
      "--exclude=build",
      "-czf",
      archivePath,
      "-C",
      root,
      ".",
    ], { maxBuffer: 20 * 1024 * 1024 });
    await sendFile({ filePath: archivePath });
  } finally {
    try {
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }
    } catch (err) {
      console.error(`Could not remove temporary archive: ${err.message}`);
    }
  }
}

const tools = [
  {
    name: "ask_user",
    description: "Ask the user a question via Telegram and wait for their response",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "The question to ask the user" } },
      required: ["question"],
    },
  },
  {
    name: "notify_user",
    description: "Send a notification message to the user via Telegram",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string", description: "The message to send" } },
      required: ["message"],
    },
  },
  {
    name: "send_file",
    description: "Send a file to the user via Telegram",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string", description: "Path of the file to send" } },
      required: ["filePath"],
    },
  },
  {
    name: "send_image",
    description: "Send an image to the user via Telegram",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Path of the image file to send" },
        caption: { type: "string", description: "Optional image caption" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "zip_project",
    description: "Create a project archive and send it to the user via Telegram",
    inputSchema: {
      type: "object",
      properties: { directory: { type: "string", description: "Directory to archive" } },
      required: [],
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(request) {
  if (!request || request.jsonrpc !== "2.0") {
    return;
  }

  if (request.id === undefined || request.id === null) {
    return;
  }

  try {
    switch (request.method) {
      case "initialize":
        result(request.id, {
          protocolVersion: request.params && request.params.protocolVersion ? request.params.protocolVersion : "2024-11-05",
          serverInfo: { name: "mcp-communicator-telegram-local", version: "0.1.0" },
          capabilities: { tools: {} },
        });
        break;
      case "tools/list":
        result(request.id, { tools });
        break;
      case "tools/call": {
        const name = request.params && request.params.name;
        const args = (request.params && request.params.arguments) || {};
        if (name === "ask_user") {
          const answer = await askUser(args);
          result(request.id, { content: [{ type: "text", text: answer }] });
        } else if (name === "notify_user") {
          await notifyUser(args);
          result(request.id, { content: [{ type: "text", text: "Notification sent successfully" }] });
        } else if (name === "send_file") {
          await sendFile(args);
          result(request.id, { content: [{ type: "text", text: "File sent successfully" }] });
        } else if (name === "send_image") {
          await sendImage(args);
          result(request.id, { content: [{ type: "text", text: "Image sent successfully" }] });
        } else if (name === "zip_project") {
          await zipProject(args);
          result(request.id, { content: [{ type: "text", text: "Project archive sent successfully" }] });
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }
        break;
      }
      default:
        error(request.id, -32601, `Method not found: ${request.method}`);
    }
  } catch (err) {
    error(request.id, -32000, err && err.message ? err.message : "Unknown error");
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  try {
    handle(JSON.parse(line));
  } catch (err) {
    console.error(`Invalid JSON-RPC message: ${err.message}`);
  }
});
