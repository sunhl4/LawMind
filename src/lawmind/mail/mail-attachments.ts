/**
 * Resolve workspace-relative paths for outbound mail attachments (sandbox-safe).
 */

import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceRelativePath } from "../runtime/workspace-path.js";

export type ResolvedMailAttachment = {
  filename: string;
  absolutePath: string;
  contentType?: string;
};

export function resolveOutboundAttachmentPaths(
  workspaceDir: string,
  relativePaths: string[] | undefined,
): { ok: true; files: ResolvedMailAttachment[] } | { ok: false; error: string } {
  if (!relativePaths?.length) {
    return { ok: true, files: [] };
  }
  const files: ResolvedMailAttachment[] = [];
  for (const raw of relativePaths) {
    const resolved = resolveWorkspaceRelativePath(workspaceDir, raw);
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.error === "empty" ? `非法附件路径：${raw}` : `附件路径越出工作区：${raw}`,
      };
    }
    const abs = resolved.abs;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return { ok: false, error: `附件不存在：${raw}` };
    }
    const filename = path.basename(resolved.abs);
    const contentType = /\.docx$/i.test(filename)
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : /\.pdf$/i.test(filename)
        ? "application/pdf"
        : undefined;
    files.push({ filename, absolutePath: abs, contentType });
  }
  return { ok: true, files };
}
