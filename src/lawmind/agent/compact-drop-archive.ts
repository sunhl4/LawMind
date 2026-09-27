/**
 * 压缩时丢掉的原话按会话落盘。整理稿里只留相对路径，正文不注入提示。
 * 写法对齐工具回包 spill。
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import type { AgentMessage } from "./types.js";

export function sanitizeCompactDropId(boundaryId: string): string {
  const safe = boundaryId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  return safe || "drop";
}

export function compactDropRelPath(sessionId: string, boundaryId: string): string {
  return path.posix.join(
    "sessions",
    `${sessionId}.drops`,
    `${sanitizeCompactDropId(boundaryId)}.json`,
  );
}

export function workspaceRelativePath(workspaceDir: string, absolutePath: string): string {
  const rel = path.relative(workspaceDir, absolutePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return absolutePath.split(path.sep).join("/");
  }
  return rel.split(path.sep).join("/");
}

/** 写入失败返回 undefined，压缩仍用提取式要点继续。 */
export function writeCompactDropArchive(opts: {
  workspaceDir: string;
  sessionId: string;
  boundaryId: string;
  messages: readonly AgentMessage[];
}): string | undefined {
  if (!opts.sessionId.trim() || opts.messages.length === 0) {
    return undefined;
  }
  try {
    const rel = compactDropRelPath(opts.sessionId, opts.boundaryId);
    const filePath = path.join(opts.workspaceDir, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    writeJsonAtomic(filePath, {
      boundaryId: opts.boundaryId,
      savedAt: new Date().toISOString(),
      messages: opts.messages,
    });
    try {
      fs.chmodSync(filePath, 0o600);
      fs.chmodSync(path.dirname(filePath), 0o700);
    } catch {
      /* chmod is best-effort on some volumes */
    }
    return rel;
  } catch {
    return undefined;
  }
}
