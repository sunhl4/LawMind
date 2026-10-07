/**
 * 任务完成且本轮写出了办公交付件时，把文件地址补进给律师的回复。
 * 地址是可点的 lm-wps 链接：Word 左键进中栏核对，其它办公件左键进中栏；右键可去访达或用本机应用打开。
 *
 * 路径可落在 LawMind workspace，也可落在会话的 projectDir（本机案件文件夹）。
 * notes/*.md 与 *.json 不进交付链接——那些留给模型上下文，不给律师点。
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

export type DeliverableLinkRoots = {
  workspaceDir: string;
  projectDir?: string;
};

function normalizeRoot(root: string): string {
  return path.resolve(root).replace(/\\/g, "/").replace(/\/$/, "");
}

/** 绝对路径若落在 root 下，返回相对路径；否则 null。 */
function relUnderRoot(root: string, absolute: string): string | null {
  const base = normalizeRoot(root);
  const abs = path.resolve(absolute).replace(/\\/g, "/");
  if (abs !== base && !abs.startsWith(`${base}/`)) {
    return null;
  }
  return abs.slice(base.length).replace(/^\//, "");
}

function toDeliverableRel(roots: DeliverableLinkRoots, value: string): string | null {
  let raw = value.trim().replace(/\\/g, "/");
  if (!raw) {
    return null;
  }
  const absolute = raw.startsWith("/") || /^[A-Za-z]:\//.test(raw);
  if (absolute) {
    const underWorkspace = roots.workspaceDir.trim() ? relUnderRoot(roots.workspaceDir, raw) : null;
    if (underWorkspace) {
      return wpsDeliverablePath(underWorkspace);
    }
    const project = roots.projectDir?.trim();
    if (project) {
      const underProject = relUnderRoot(project, raw);
      if (underProject) {
        return wpsDeliverablePath(underProject);
      }
    }
    return null;
  }
  return wpsDeliverablePath(raw);
}

function pushPath(out: string[], roots: DeliverableLinkRoots, value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const rel = toDeliverableRel(roots, value);
  if (rel && !out.includes(rel)) {
    out.push(rel);
  }
}

function pushAppliedLine(out: string[], roots: DeliverableLinkRoots, line: unknown): void {
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
  pushPath(out, roots, dest);
}

function pushRecord(out: string[], roots: DeliverableLinkRoots, data: unknown): void {
  if (!data || typeof data !== "object") {
    return;
  }
  const rec = data as Record<string, unknown>;
  for (const key of ["filePath", "outputRelativePath", "outputPath", "path", "destRel"]) {
    pushPath(out, roots, rec[key]);
  }
  for (const key of ["tables", "charts", "files"]) {
    const rows = rec[key];
    if (!Array.isArray(rows)) {
      continue;
    }
    for (const row of rows) {
      if (row && typeof row === "object") {
        pushPath(out, roots, (row as { path?: unknown }).path);
      }
    }
  }
  if (Array.isArray(rec.applied)) {
    for (const line of rec.applied) {
      pushAppliedLine(out, roots, line);
    }
  }
}

function officecliPaths(
  messages: AgentMessage[],
  toolCallId: string,
  roots: DeliverableLinkRoots,
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
      pushPath(out, roots, arg);
    }
    return;
  }
}

function normalizeRoots(
  workspaceDir: string | DeliverableLinkRoots,
  projectDir?: string,
): DeliverableLinkRoots {
  if (typeof workspaceDir === "string") {
    return { workspaceDir, ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}) };
  }
  return workspaceDir;
}

/** 本轮成功写出、且 WPS 能打开的相对路径。读文件和失败的导出不算。 */
export function collectDeliverablePaths(
  messages: AgentMessage[],
  workspaceDir: string | DeliverableLinkRoots,
  projectDir?: string,
): string[] {
  const roots = normalizeRoots(workspaceDir, projectDir);
  const out: string[] = [];
  if (!roots.workspaceDir.trim() && !roots.projectDir?.trim()) {
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
        officecliPaths(messages, response.toolCallId, roots, out);
        continue;
      }
      if (!DELIVERABLE_TOOLS.has(response.name)) {
        continue;
      }
      pushRecord(out, roots, response.result.data);
    }
  }
  return out;
}

function markdownLabel(rel: string): string {
  const base = rel.split("/").pop() || rel;
  return base.replaceAll("[", "［").replaceAll("]", "］");
}

/**
 * 在回复末尾补上还没出现过的交付文件地址。没有可打开的文件时原样返回。
 */
export function appendDeliverableFileLinks(
  reply: string,
  messages: AgentMessage[],
  workspaceDir: string | DeliverableLinkRoots,
  projectDir?: string,
): string {
  const roots = normalizeRoots(workspaceDir, projectDir);
  const missing = collectDeliverablePaths(messages, roots).filter((rel) => {
    const href = wpsDeliverableHref(rel);
    if (!href) {
      return false;
    }
    // 正文里已有 lm-wps 链接，或已写出同一相对路径 / 文件名的 Markdown 链，就不再重复脚注。
    if (reply.includes(href) || reply.includes(`](${rel})`)) {
      return false;
    }
    return true;
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
