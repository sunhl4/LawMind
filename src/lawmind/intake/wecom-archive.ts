/**
 * 企业微信会话存档（P2.2）：官方导出的**已解密**消息 JSON/JSONL → IntakeItem。
 *
 * 边界（与 SECURITY.md、P2 计划一致）：
 * - 不逆向个人微信，不破解企微加密包；这里只吃官方 SDK/合规导出后的明文消息。
 * - 不做“自动同步”：实时拉取需要企业资质、存档密钥和腾讯官方 C++ SDK，
 *   那一步需要单独的 native bridge；本模块是文件落地后的统一收件适配器。
 * - 每条消息只产生一个 `IntakeItem`（`channel: "wecom"`），不另建案件真相源；
 *   图片/语音/文件只登记元数据（没有二进制，标 `type_not_persisted`），
 *   不假装已经拿到原件。
 *
 * 目录约定：`<workspace>/收件投递/企业微信/*.json|*.jsonl`。扫描后移到
 * `收件投递/已入库/<day>/企业微信/`；解析失败移到 `已入库/失败/<day>/企业微信/`，
 * 文件保留、错误上报，不会每个 tick 重试同一坏文件。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { INTAKE_WECOM_DIRNAME, intakeDropzoneDir } from "./dropzone.js";
import { buildIntakeMatterIndex } from "./matter-index.js";
import type { IntakeMatterIndex } from "./resolve.js";
import { findIntakeItemId, recordIntakeItem } from "./store.js";
import { triageIntakeItem } from "./triage.js";
import type { NewIntakeItem } from "./types.js";

const MAX_FILES_PER_SCAN = 20;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const CONSUMED_DIRNAME = "已入库";
const FAILED_DIRNAME = "失败";

export type WecomMessage = {
  msgid?: string;
  action?: string;
  from?: string;
  tolist?: string[];
  to?: string | string[];
  roomid?: string;
  roomname?: string;
  msgtime?: number | string;
  msgtype?: string;
  text?: { content?: string } | string;
  content?: string;
  file?: { filename?: string; filesize?: number };
  image?: { filesize?: number };
  voice?: { filesize?: number; duration?: number };
  video?: { filesize?: number };
};

export type WecomArchive = {
  users: Record<string, string>;
  messages: WecomMessage[];
};

export type WecomScanResult = {
  scanned: number;
  recorded: number;
  duplicates: number;
  errors: Array<{ file: string; error: string }>;
};

export function wecomArchiveDir(workspaceDir: string): string {
  return path.join(intakeDropzoneDir(workspaceDir), INTAKE_WECOM_DIRNAME);
}

export function ensureWecomArchiveDir(workspaceDir: string): string {
  const dir = wecomArchiveDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseObject(row: unknown): WecomMessage | undefined {
  if (!row || typeof row !== "object") {
    return undefined;
  }
  return row as WecomMessage;
}

/**
 * 支持三种导出形态：消息数组、`{users, messages}`、单条消息对象；也支持 JSONL。
 * 解析失败抛错，由扫描器把文件移到失败目录。
 */
export function parseWecomArchive(text: string): WecomArchive {
  const raw = text.replace(/^\uFEFF/, "").trim();
  if (!raw) {
    throw new Error("empty_archive");
  }
  const collected: WecomMessage[] = [];
  const users: Record<string, string> = {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        const message = parseObject(row);
        if (message) {
          collected.push(message);
        }
      }
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as { users?: unknown; messages?: unknown };
      if (Array.isArray(obj.messages)) {
        if (obj.users && typeof obj.users === "object") {
          for (const [id, name] of Object.entries(obj.users as Record<string, unknown>)) {
            const label = asString(name);
            if (label) {
              users[id] = label;
            }
          }
        }
        for (const row of obj.messages) {
          const message = parseObject(row);
          if (message) {
            collected.push(message);
          }
        }
      } else {
        const message = parseObject(parsed);
        if (message) {
          collected.push(message);
        }
      }
    }
  } catch {
    // JSONL fallback：一行一条消息。
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const message = parseObject(JSON.parse(trimmed) as unknown);
      if (message) {
        collected.push(message);
      }
    }
  }

  if (collected.length === 0) {
    throw new Error("no_messages");
  }
  return { users, messages: collected };
}

function messageTime(raw: number | string | undefined, fallback: Date): string {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // 企微存档 msgtime 是毫秒；容忍秒级导出。
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
  }
  const text = asString(raw);
  if (text) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return fallback.toISOString();
}

function textContent(message: WecomMessage): string {
  if (typeof message.text === "string") {
    return message.text.trim();
  }
  const nested = message.text?.content;
  if (typeof nested === "string") {
    return nested.trim();
  }
  return asString(message.content);
}

function placeholderFor(message: WecomMessage): string {
  const type = asString(message.msgtype).toLowerCase();
  switch (type) {
    case "image":
      return "[图片]";
    case "voice":
      return message.voice?.duration ? `[语音 ${message.voice.duration}″]` : "[语音]";
    case "video":
      return "[视频]";
    case "file":
      return message.file?.filename ? `[文件] ${message.file.filename}` : "[文件]";
    case "link":
      return "[链接]";
    case "location":
      return "[位置]";
    case "emotion":
      return "[表情]";
    case "":
      return "[非文本消息]";
    default:
      return `[${type}]`;
  }
}

function attachmentFor(message: WecomMessage): NewIntakeItem["attachments"] {
  const type = asString(message.msgtype).toLowerCase();
  if (type === "file" && message.file?.filename) {
    return [
      {
        name: message.file.filename,
        size: Math.max(0, Math.floor(message.file.filesize ?? 0)),
        skippedReason: "type_not_persisted",
      },
    ];
  }
  if (type === "voice") {
    return [
      {
        name: "语音",
        size: Math.max(0, Math.floor(message.voice?.filesize ?? 0)),
        skippedReason: "type_not_persisted",
      },
    ];
  }
  if (type === "image") {
    return [
      {
        name: "图片",
        size: Math.max(0, Math.floor(message.image?.filesize ?? 0)),
        skippedReason: "type_not_persisted",
      },
    ];
  }
  return [];
}

function conversationId(message: WecomMessage, sender: string, recipients: string[]): string {
  const room = asString(message.roomid);
  if (room) {
    return `room:${room}`;
  }
  const people = [sender, ...recipients].filter(Boolean).toSorted();
  return `dm:${people.join(",")}`;
}

function messageKey(message: WecomMessage): string {
  const msgid = asString(message.msgid);
  if (msgid) {
    return `wecom:${msgid}`;
  }
  return `wecom:${createHash("sha256").update(JSON.stringify(message), "utf8").digest("hex")}`;
}

/** 把一条已解密的企微消息转成统一收件契约；撤回消息也保留一条记录。 */
export function toIntakeItemInput(
  message: WecomMessage,
  opts: { users?: Record<string, string>; sourceFile: string; now?: Date },
): NewIntakeItem {
  const users = opts.users ?? {};
  const now = opts.now ?? new Date();
  const senderId = asString(message.from);
  const sender = users[senderId] || senderId || "未知发送者";
  const recipientsRaw = Array.isArray(message.tolist)
    ? message.tolist
    : typeof message.to === "string"
      ? message.to.split(/[,;，；]+/)
      : Array.isArray(message.to)
        ? message.to
        : [];
  const recipients = recipientsRaw.map((row) => asString(row)).filter(Boolean);
  const recipientsLabel = recipients.map((id) => users[id] || id);
  const room = asString(message.roomid);
  const roomName = asString(message.roomname);
  const recalled = asString(message.action).toLowerCase() === "recall";
  const body = recalled ? "[消息已撤回]" : textContent(message) || placeholderFor(message);
  const subject = roomName || (room ? `群聊 ${room}` : "企业微信会话");
  return {
    channel: "wecom",
    externalKey: messageKey(message),
    receivedAt: messageTime(message.msgtime, now),
    from: { display: sender, ...(senderId.includes("@") ? { address: senderId } : {}) },
    ...(recipientsLabel.length > 0 ? { to: recipientsLabel.join("、") } : {}),
    subject,
    text: body,
    thread: { conversationId: conversationId(message, senderId, recipients) },
    attachments: attachmentFor(message),
    source: {
      dropzoneRelPath: opts.sourceFile,
      ...(asString(message.msgid) ? { providerMessageId: asString(message.msgid) } : {}),
    },
  };
}

function moveArchive(root: string, abs: string, day: string, failed: boolean): void {
  const dir = path.join(
    root,
    CONSUMED_DIRNAME,
    ...(failed ? [FAILED_DIRNAME, day, INTAKE_WECOM_DIRNAME] : [day, INTAKE_WECOM_DIRNAME]),
  );
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(abs);
  const stem = path.basename(abs, ext);
  for (let n = 1; n < 100; n += 1) {
    const target = path.join(dir, n === 1 ? `${stem}${ext}` : `${stem} (${n})${ext}`);
    if (!fs.existsSync(target)) {
      fs.renameSync(abs, target);
      return;
    }
  }
}

/**
 * 扫描 `<workspace>/收件投递/企业微信/`：每个文件解析成多条消息，逐条入库并判案。
 * 同一个 `msgid` 反复导入只记一条。
 */
export function scanWecomArchive(
  workspaceDir: string,
  opts?: { index?: IntakeMatterIndex; now?: Date },
): WecomScanResult {
  const result: WecomScanResult = { scanned: 0, recorded: 0, duplicates: 0, errors: [] };
  const root = intakeDropzoneDir(workspaceDir);
  const dir = wecomArchiveDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    return result;
  }
  const now = opts?.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  let index = opts?.index;
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(json|jsonl)$/i.test(entry.name))
    .map((entry) => entry.name)
    .toSorted()
    .slice(0, MAX_FILES_PER_SCAN);

  for (const name of files) {
    const abs = path.join(dir, name);
    result.scanned += 1;
    let archive: WecomArchive;
    try {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_ARCHIVE_BYTES) {
        throw new Error("file_too_large");
      }
      archive = parseWecomArchive(fs.readFileSync(abs, "utf8"));
    } catch (err) {
      result.errors.push({
        file: name,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        moveArchive(root, abs, day, true);
      } catch {
        /* 移不走就留在原地，下轮再试 */
      }
      continue;
    }
    for (const message of archive.messages) {
      const input = toIntakeItemInput(message, {
        users: archive.users,
        sourceFile: `${INTAKE_WECOM_DIRNAME}/${name}`,
        now,
      });
      if (findIntakeItemId(workspaceDir, { externalKey: input.externalKey })) {
        result.duplicates += 1;
        continue;
      }
      const { item, created } = recordIntakeItem(workspaceDir, input, { now });
      if (!created) {
        result.duplicates += 1;
        continue;
      }
      result.recorded += 1;
      index ??= buildIntakeMatterIndex(workspaceDir);
      triageIntakeItem(workspaceDir, item, index, { now });
    }
    try {
      moveArchive(root, abs, day, false);
    } catch {
      /* 移不走就留在原地；msgid 去重保证不会重复入库 */
    }
  }
  return result;
}
