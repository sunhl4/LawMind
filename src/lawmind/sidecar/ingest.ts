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
