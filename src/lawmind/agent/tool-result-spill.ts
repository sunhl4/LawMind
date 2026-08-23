/**
 * Persist oversized read/research/mail tool results so history can stay slim
 * without losing the full payload. Write/render/send execute paths are excluded.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";

const NO_SPILL_TOOLS = new Set([
  "write_document",
  "apply_surgical_edits",
  "update_draft",
  "render_document",
  "render_tracked_draft",
  "persistDraft",
  "send_email",
  "prepare_outbound_mail",
  "draft_document",
]);

export type ToolResultSpillContext = {
  workspaceDir: string;
  sessionId: string;
  callId: string;
  toolName: string;
};

export function shouldSpillToolResult(toolName: string): boolean {
  const name = toolName.trim();
  if (!name || NO_SPILL_TOOLS.has(name)) {
    return false;
  }
  return (
    name === "analyze_document" ||
    name === "compare_documents" ||
    name === "web_search" ||
    /^(research_|list_mail_|read_|search_|browse)/.test(name)
  );
}

export function sanitizeSpillCallId(callId: string): string {
  const safe = callId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  return safe || "call";
}

export function toolResultSpillDir(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, "sessions", `${sessionId}.spills`);
}

export function toolResultSpillRelPath(sessionId: string, callId: string): string {
  return path.posix.join("sessions", `${sessionId}.spills`, `${sanitizeSpillCallId(callId)}.json`);
}

/** Best-effort: returns workspace-relative path, or undefined if write failed. */
export function writeToolResultSpill(
  ctx: ToolResultSpillContext,
  result: unknown,
): string | undefined {
  try {
    const dir = toolResultSpillDir(ctx.workspaceDir, ctx.sessionId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const rel = toolResultSpillRelPath(ctx.sessionId, ctx.callId);
    const filePath = path.join(ctx.workspaceDir, rel);
    writeJsonAtomic(filePath, {
      toolName: ctx.toolName,
      callId: ctx.callId,
      savedAt: new Date().toISOString(),
      result,
    });
    try {
      fs.chmodSync(filePath, 0o600);
      fs.chmodSync(dir, 0o700);
    } catch {
      /* chmod is best-effort on some volumes */
    }
    return rel;
  } catch {
    return undefined;
  }
}
