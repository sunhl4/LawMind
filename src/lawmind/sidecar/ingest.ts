/**
 * lawmindd 收件：Word/WPS 把选中文字送到本机工作区 inbox。
 */

import fs from "node:fs";
import path from "node:path";
import { composeSidecarPrompt, inferDeskVerb, type DeskVerb } from "../desk/verbs.js";

export type SidecarSource = "word" | "wps" | "paste";

export type SidecarIngestInput = {
  source?: string;
  title?: string;
  text: string;
  verb?: string;
};

export type SidecarIngestResult = {
  relativePath: string;
  verb: DeskVerb;
  prompt: string;
  charCount: number;
};

export type SidecarPendingItem = {
  relativePath: string;
  title: string;
  source: SidecarSource;
  verb: DeskVerb;
  prompt: string;
  charCount: number;
  mtimeMs: number;
};

export const SIDECAR_FILE_RE = /^sidecar-(word|wps|paste)-.+\.md$/;

export function isSidecarInboxRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").replace(/^\//, "");
  if (!normalized.startsWith("inbox/") || normalized.includes("..")) {
    return false;
  }
  return SIDECAR_FILE_RE.test(path.basename(normalized));
}
const ACK_REL = "lawmind/sidecar-acked.json";
const ACK_CAP = 200;

function normalizeSource(value: string | undefined): SidecarSource {
  if (value === "wps" || value === "word" || value === "paste") {
    return value;
  }
  return "word";
}

function normalizeVerb(value: string | undefined, text: string): DeskVerb {
  if (value === "review" || value === "draft" || value === "research") {
    return value;
  }
  return inferDeskVerb(text) ?? "review";
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function ingestSidecarSelection(
  workspaceDir: string,
  input: SidecarIngestInput,
): SidecarIngestResult {
  const text = input.text.trim();
  if (!text) {
    throw new Error("empty_selection");
  }
  if (text.length > 80_000) {
    throw new Error("selection_too_large");
  }
  const verb = normalizeVerb(input.verb, text);
  const source = normalizeSource(input.source);
  const inbox = path.join(workspaceDir, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const filename = `sidecar-${source}-${stamp()}.md`;
  const absolute = path.join(inbox, filename);
  const title = input.title?.trim() || "来自 Word / WPS 的选区";
  const body = [
    `# ${title}`,
    "",
    `- 来源：${source}`,
    `- 动词：${verb}`,
    `- 字数：${text.length}`,
    "",
    text,
    "",
  ].join("\n");
  fs.writeFileSync(absolute, body, "utf8");
  return {
    relativePath: `inbox/${filename}`,
    verb,
    prompt: composeSidecarPrompt(verb, text),
    charCount: text.length,
  };
}

export function parseSidecarInboxMarkdown(markdown: string): {
  title: string;
  source: SidecarSource;
  verb: DeskVerb;
  selection: string;
} {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const titleLine = lines.find((line) => line.startsWith("# "));
  const title = titleLine?.slice(2).trim() || "来自 Word / WPS 的选区";
  const sourceMatch = /^- 来源：(\S+)/m.exec(markdown);
  const verbMatch = /^- 动词：(\S+)/m.exec(markdown);
  const source = normalizeSource(sourceMatch?.[1]);
  const verb = normalizeVerb(verbMatch?.[1], markdown);
  let start = lines.findIndex((line) => line.startsWith("- 字数："));
  if (start < 0) {
    start = lines.findIndex((line) => line.startsWith("# "));
  }
  start += 1;
  while (start < lines.length && lines[start]?.trim() === "") {
    start += 1;
  }
  const selection = lines.slice(Math.max(start, 0)).join("\n").trim();
  return { title, source, verb, selection };
}

function ackFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, ...ACK_REL.split("/"));
}

function readAckedPaths(workspaceDir: string): Set<string> {
  const file = ackFilePath(workspaceDir);
  if (!fs.existsSync(file)) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { paths?: unknown };
    const paths = Array.isArray(parsed.paths)
      ? parsed.paths.filter((p): p is string => typeof p === "string" && p.startsWith("inbox/"))
      : [];
    return new Set(paths);
  } catch {
    return new Set();
  }
}

function writeAckedPaths(workspaceDir: string, paths: Set<string>): void {
  const file = ackFilePath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const list = [...paths].slice(-ACK_CAP);
  fs.writeFileSync(file, `${JSON.stringify({ paths: list }, null, 2)}\n`, "utf8");
}

export function resolveSidecarInboxPath(workspaceDir: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\//, "");
  if (!normalized.startsWith("inbox/") || normalized.includes("..")) {
    throw new Error("invalid_sidecar_path");
  }
  const base = path.basename(normalized);
  if (!SIDECAR_FILE_RE.test(base)) {
    throw new Error("invalid_sidecar_path");
  }
  return path.join(workspaceDir, "inbox", base);
}

export function listPendingSidecarIngests(workspaceDir: string, limit = 8): SidecarPendingItem[] {
  const inbox = path.join(workspaceDir, "inbox");
  if (!fs.existsSync(inbox)) {
    return [];
  }
  const acked = readAckedPaths(workspaceDir);
  const items: SidecarPendingItem[] = [];
  for (const name of fs.readdirSync(inbox)) {
    if (!SIDECAR_FILE_RE.test(name)) {
      continue;
    }
    const relativePath = `inbox/${name}`;
    if (acked.has(relativePath)) {
      continue;
    }
    const absolute = path.join(inbox, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }
    const parsed = parseSidecarInboxMarkdown(fs.readFileSync(absolute, "utf8"));
    items.push({
      relativePath,
      title: parsed.title,
      source: parsed.source,
      verb: parsed.verb,
      prompt: composeSidecarPrompt(parsed.verb, parsed.selection),
      charCount: parsed.selection.length,
      mtimeMs: stat.mtimeMs,
    });
  }
  return items.toSorted((a, b) => b.mtimeMs - a.mtimeMs).slice(0, Math.max(1, limit));
}

export function acknowledgeSidecarIngest(
  workspaceDir: string,
  relativePath: string,
): { relativePath: string } {
  const absolute = resolveSidecarInboxPath(workspaceDir, relativePath);
  if (!fs.existsSync(absolute)) {
    throw new Error("sidecar_not_found");
  }
  const normalized = `inbox/${path.basename(absolute)}`;
  const acked = readAckedPaths(workspaceDir);
  acked.add(normalized);
  writeAckedPaths(workspaceDir, acked);
  return { relativePath: normalized };
}
