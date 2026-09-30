/**
 * 任务完成且本轮写出了 WPS 能打开的文件时，把文件地址补进给律师的回复。
 * 地址是可点的 lm-wps 链接，点击后只交给 WPS。
 */

import path from "node:path";
import { wpsDeliverableHref, wpsDeliverablePath } from "../sources/lawyer-chat-link.js";
import type { AgentMessage } from "./types.js";

const DELIVERABLE_TOOLS = new Set([
  "write_document",
  "write_spreadsheet",
  "render_document",
  "render_tracked_draft",
  "import_host_file",
  "execute_workflow",
  "run_compute",
  "run_analysis",
  "apply_file_ops",
]);

function toWorkspaceRel(workspaceDir: string, value: string): string | null {
  let raw = value.trim().replace(/\\/g, "/");
  if (!raw) {
    return null;
  }
  const root = path.resolve(workspaceDir).replace(/\\/g, "/").replace(/\/$/, "");
  const absolute = raw.startsWith("/") || /^[A-Za-z]:\//.test(raw);
  if (absolute) {
    const abs = path.resolve(raw).replace(/\\/g, "/");
    if (abs !== root && !abs.startsWith(`${root}/`)) {
      return null;
    }
    raw = abs.slice(root.length).replace(/^\//, "");
  }
  return wpsDeliverablePath(raw);
}

function pushPath(out: string[], workspaceDir: string, value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const rel = toWorkspaceRel(workspaceDir, value);
  if (rel && !out.includes(rel)) {
    out.push(rel);
  }
}

function pushAppliedLine(out: string[], workspaceDir: string, line: unknown): void {
  if (typeof line !== "string") {
    return;
  }
  const marker = " → ";
  const at = line.lastIndexOf(marker);
  if (at < 0) {
    return;
  }
  const dest = line
    .slice(at + marker.length)
    .replace(/（复制）$/, "")
    .trim();
  pushPath(out, workspaceDir, dest);
}

function pushRecord(out: string[], workspaceDir: string, data: unknown): void {
  if (!data || typeof data !== "object") {
    return;
  }
  const rec = data as Record<string, unknown>;
  for (const key of ["filePath", "outputRelativePath", "outputPath", "path", "destRel"]) {
    pushPath(out, workspaceDir, rec[key]);
  }
  for (const key of ["tables", "charts", "files"]) {
    const rows = rec[key];
    if (!Array.isArray(rows)) {
      continue;
    }
    for (const row of rows) {
      if (row && typeof row === "object") {
        pushPath(out, workspaceDir, (row as { path?: unknown }).path);
      }
    }
  }
  if (Array.isArray(rec.applied)) {
    for (const line of rec.applied) {
      pushAppliedLine(out, workspaceDir, line);
    }
  }
}

function officecliPaths(
  messages: AgentMessage[],
  toolCallId: string,
  workspaceDir: string,
  out: string[],
): void {
  for (const msg of messages) {
    const call = msg.toolCalls?.find((item) => item.id === toolCallId);
    if (!call || call.name !== "run_host_command") {
      continue;
    }
    const command = call.arguments.command;
    if (command !== "officecli") {
      return;
    }
    const args = call.arguments.args;
    if (!Array.isArray(args)) {
      return;
    }
    for (const arg of args) {
      pushPath(out, workspaceDir, arg);
    }
    return;
  }
}

/** 本轮成功写出、且 WPS 能打开的工作区相对路径。读文件和失败的导出不算。 */
export function collectDeliverablePaths(messages: AgentMessage[], workspaceDir: string): string[] {
  const out: string[] = [];
  if (!workspaceDir.trim()) {
    return out;
  }
  for (const msg of messages) {
    if (msg.role !== "tool" || !msg.toolCallResponses?.length) {
      continue;
    }
    for (const response of msg.toolCallResponses) {
      if (!response.result.ok) {
        continue;
      }
      if (response.name === "run_host_command") {
        officecliPaths(messages, response.toolCallId, workspaceDir, out);
        continue;
      }
      if (!DELIVERABLE_TOOLS.has(response.name)) {
        continue;
      }
      pushRecord(out, workspaceDir, response.result.data);
    }
  }
  return out;
}

function markdownLabel(rel: string): string {
  return rel.replaceAll("[", "［").replaceAll("]", "］");
}

/**
 * 在回复末尾补上还没出现过的交付文件地址。没有可打开的文件时原样返回。
 */
export function appendDeliverableFileLinks(
  reply: string,
  messages: AgentMessage[],
  workspaceDir: string,
): string {
  const missing = collectDeliverablePaths(messages, workspaceDir).filter((rel) => {
    const href = wpsDeliverableHref(rel);
    return Boolean(href && !reply.includes(href));
  });
  if (missing.length === 0) {
    return reply;
  }
  const lines = ["交付文件"];
  for (const rel of missing) {
    const href = wpsDeliverableHref(rel);
    if (!href) {
      continue;
    }
    lines.push(`- [${markdownLabel(rel)}](${href})`);
  }
  if (lines.length === 1) {
    return reply;
  }
  const footer = lines.join("\n");
  const body = reply.trim();
  return body ? `${body}\n\n${footer}` : footer;
}
