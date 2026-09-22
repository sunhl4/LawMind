/**
 * 工具参数归一化 — 在 schema 校验前修正常见模型拼写/缺省。
 */

import path from "node:path";
import { resolveDefaultDeliverableLocation } from "../artifacts/default-output-location.js";
import type { ToolCallContext } from "../runtime/tool-pipeline.js";
import { isPathInsideRoot } from "../runtime/workspace-path.js";

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
    if (args.file_path === undefined && typeof args.content === "string") {
      const linked = call.ctx.linkedTaskId?.trim();
      if (linked) {
        args.file_path = `drafts/${linked}.json`;
      } else {
        const located = resolveDefaultDeliverableLocation({
          workspaceDir: call.ctx.workspaceDir,
          matterId: call.ctx.matterId,
          title: "工作笔记",
          extension: ".md",
          kind: "note",
        });
        if (located.ok && isPathInsideRoot(call.ctx.workspaceDir, located.planned.outputPath)) {
          args.file_path = path
            .relative(call.ctx.workspaceDir, located.planned.outputPath)
            .replace(/\\/g, "/");
        }
      }
    }
  }

  if (call.toolName === "update_draft") {
    if (args.task_id === undefined && call.ctx.linkedTaskId?.trim()) {
      args.task_id = call.ctx.linkedTaskId.trim();
    }
  }

  if (call.toolName === "update_plan") {
    if (args.plan === undefined && args.items !== undefined) {
      args.plan = args.items;
    }
    if (typeof args.plan === "string") {
      const trimmed = args.plan.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed)) {
            args.plan = parsed;
          }
        } catch {
          /* validateToolArguments will reject the string */
        }
      }
    }
  }
}
