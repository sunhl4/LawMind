/**
 * 任务完成且本轮写出了办公交付件时，把文件地址补进给律师的回复。
 * 地址是可点的 lm-wps 链接：Word 左键进中栏核对，其它办公件左键进中栏；右键可去访达或用本机应用打开。
 *
 * 路径可落在 LawMind workspace，也可落在会话的 projectDir（本机案件文件夹）。
 * notes/*.md 与 *.json 不进交付链接——那些留给模型上下文，不给律师点。
 */

import fs from "node:fs";
import path from "node:path";
import {
  rootedWpsDeliverableHref,
  wpsDeliverableHref,
  wpsDeliverablePath,
  type LawyerChatRoot,
} from "../sources/lawyer-chat-link.js";
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

function toDeliverableTarget(
  roots: DeliverableLinkRoots,
  value: string,
): { path: string; root: LawyerChatRoot } | null {
  let raw = value.trim().replace(/\\/g, "/");
  if (!raw) {
    return null;
  }
  const finish = (rel: string, root: LawyerChatRoot) => {
    const safe = wpsDeliverablePath(rel);
    return safe ? { path: safe, root } : null;
  };
  const absolute = raw.startsWith("/") || /^[A-Za-z]:\//.test(raw);
  if (absolute) {
    const underWorkspace = roots.workspaceDir.trim() ? relUnderRoot(roots.workspaceDir, raw) : null;
    if (underWorkspace) {
      return finish(underWorkspace, "workspace");
    }
    const project = roots.projectDir?.trim();
    if (project) {
      const underProject = relUnderRoot(project, raw);
      if (underProject) {
        return finish(underProject, "project");
      }
    }
    return null;
  }
  const rel = wpsDeliverablePath(raw);
  if (!rel) {
    return null;
  }
  // 相对路径本身说明不了 root。交付件是刚写出的，磁盘探测一次就能定案，
  // 不再让点击侧拿 `cases/` 前缀猜（workspace 根的 artifacts/ 就是被这条猜测打错根的）。
  if (roots.workspaceDir.trim() && fs.existsSync(path.join(roots.workspaceDir, rel))) {
    return finish(rel, "workspace");
  }
  const project = roots.projectDir?.trim();
  if (project && fs.existsSync(path.join(project, rel))) {
    return finish(rel, "project");
  }
  // 磁盘上还看不见（挂载时机等）时沿用旧口径：cases/ 前缀=工作区，其余按项目目录。
  return finish(rel, rel.startsWith("cases/") ? "workspace" : "project");
}

function pushPath(
  out: Array<{ path: string; root: LawyerChatRoot }>,
  roots: DeliverableLinkRoots,
  value: unknown,
): void {
  if (typeof value !== "string") {
    return;
  }
  const target = toDeliverableTarget(roots, value);
  if (target && !out.some((item) => item.path === target.path)) {
    out.push(target);
  }
}

function pushAppliedLine(
  out: Array<{ path: string; root: LawyerChatRoot }>,
  roots: DeliverableLinkRoots,
  line: unknown,
): void {
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

function pushRecord(
  out: Array<{ path: string; root: LawyerChatRoot }>,
  roots: DeliverableLinkRoots,
  data: unknown,
): void {
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
  out: Array<{ path: string; root: LawyerChatRoot }>,
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

export type DeliverablePathTarget = {
  /** WPS 可打开的相对路径（相对 workspace 或 projectDir）。 */
  path: string;
  /** 这份交付件所在根，发链接时写进 `lm-wps:` 溯源，点击侧不再猜。 */
  root: LawyerChatRoot;
};

/** 本轮成功写出、且 WPS 能打开的相对路径与所在根。读文件和失败的导出不算。 */
export function collectDeliverablePaths(
  messages: AgentMessage[],
  workspaceDir: string | DeliverableLinkRoots,
  projectDir?: string,
): DeliverablePathTarget[] {
  const roots = normalizeRoots(workspaceDir, projectDir);
  const out: DeliverablePathTarget[] = [];
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
  const missing = collectDeliverablePaths(messages, roots).filter((target) => {
    const href = rootedWpsDeliverableHref(target.path, target.root);
    if (!href) {
      return false;
    }
    // 正文里已有同文件链接（带溯源或旧式无溯源都算），就不再重复脚注。
    if (reply.includes(href)) {
      return false;
    }
    const legacy = wpsDeliverableHref(target.path);
    if (legacy && reply.includes(legacy)) {
      return false;
    }
    if (reply.includes(`](${target.path})`)) {
      return false;
    }
    return true;
  });
  if (missing.length === 0) {
    return reply;
  }
  const lines = ["交付文件"];
  for (const target of missing) {
    const href = rootedWpsDeliverableHref(target.path, target.root);
    if (!href) {
      continue;
    }
    lines.push(`- [${markdownLabel(target.path)}](${href})`);
  }
  if (lines.length === 1) {
    return reply;
  }
  const footer = lines.join("\n");
  const body = reply.trim();
  return body ? `${body}\n\n${footer}` : footer;
}
