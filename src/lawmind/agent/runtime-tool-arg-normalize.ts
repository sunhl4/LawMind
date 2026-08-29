/**
 * 工具参数归一化 — 在 schema 校验前修正常见模型拼写/缺省。
 */

import type { ToolCallContext } from "../runtime/tool-pipeline.js";

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 就地修改 call.args，便于后续 validateToolArguments。 */
export function normalizeToolCallArguments(call: ToolCallContext): void {
  const args = call.args;

  if (call.toolName === "write_document") {
    if (args.file_path === undefined) {
      const alt =
        pickString(args.path) ??
        pickString(args.filePath) ??
        pickString(args.filepath) ??
        pickString(args.file);
      if (alt) {
        args.file_path = alt;
      }
    }
    for (const alias of ["path", "filePath", "filepath", "file"] as const) {
      if (alias in args) {
        delete args[alias];
      }
    }
    if (
      args.file_path === undefined &&
      typeof args.content === "string" &&
      call.ctx.linkedTaskId?.trim()
    ) {
      args.file_path = `drafts/${call.ctx.linkedTaskId.trim()}.json`;
    }
  }

  if (call.toolName === "update_draft") {
    if (args.task_id === undefined && call.ctx.linkedTaskId?.trim()) {
      args.task_id = call.ctx.linkedTaskId.trim();
    }
  }
}
