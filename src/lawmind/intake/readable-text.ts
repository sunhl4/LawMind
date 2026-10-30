/**
 * 收案自动抽取用的正文。只读已经是文字的材料：纯文本、Word、PDF 文字层。
 * 扫描件不在这里做 OCR，避免收信 tick 卡住或去调视觉模型。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readDocxText, readPdfText } from "../agent/tools/legal/ingest-helpers.js";
import { readIntakeBlob } from "./store.js";
import type { IntakeItem } from "./types.js";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv"]);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CHARS = 20_000;

function clip(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const nul = withoutBom.indexOf(String.fromCharCode(0));
  const body = nul >= 0 ? withoutBom.slice(0, nul) : withoutBom;
  return body.trim().slice(0, MAX_CHARS);
}

function plainText(content: Buffer): string {
  if (content.includes(0)) {
    return "";
  }
  return clip(content.toString("utf8"));
}

async function textFromOfficeFile(absPath: string): Promise<string> {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".docx") {
    return clip(await readDocxText(absPath));
  }
  if (ext === ".pdf") {
    return clip(await readPdfText(absPath));
  }
  return "";
}

/** 投递口上的文件：入库前先取出能读的文字。 */
export async function readDroppedFileText(absPath: string): Promise<string> {
  const ext = path.extname(absPath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && ext !== ".docx" && ext !== ".pdf") {
    return "";
  }
  const stat = fs.statSync(absPath);
  if (stat.size > MAX_BYTES) {
    return "";
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return plainText(fs.readFileSync(absPath));
  }
  try {
    return await textFromOfficeFile(absPath);
  } catch {
    return "";
  }
}

async function textFromAttachment(name: string, content: Buffer): Promise<string> {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) {
    return plainText(content);
  }
  if (ext !== ".docx" && ext !== ".pdf") {
    return "";
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-text-"));
  const abs = path.join(dir, `attachment${ext}`);
  try {
    fs.writeFileSync(abs, content);
    return await textFromOfficeFile(abs);
  } catch {
    return "";
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 主题、正文，以及「见附件」时才补读的 Word/PDF/文本附件。
 * 正文已经够长时不再把同一份投递文件读第二遍。
 */
export async function intakeItemCorpus(workspaceDir: string, item: IntakeItem): Promise<string> {
  const parts = [item.subject ?? "", item.text];
  if (item.text.trim().length >= 80) {
    return clip(parts.join("\n"));
  }
  for (const attachment of item.attachments) {
    if (!attachment.sha256 || attachment.size > MAX_BYTES) {
      continue;
    }
    const blob = readIntakeBlob(workspaceDir, attachment.sha256);
    if (!blob) {
      continue;
    }
    const extra = await textFromAttachment(attachment.name, blob);
    if (extra) {
      parts.push(extra);
    }
  }
  return clip(parts.filter(Boolean).join("\n"));
}
