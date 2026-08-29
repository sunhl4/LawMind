/**
 * Bound tool-result payloads written into session history so giant JSON
 * cannot consume the whole context window.
 */

import { writeToolResultSpill, type ToolResultSpillContext } from "./tool-result-spill.js";
import type { ToolCallResult } from "./types.js";

export type ToolResultHistoryOpts = {
  /** Soft char budget for stringified tool content (default 16k ≈ 4k tokens @ chars/4). */
  maxChars?: number;
  /** When set and the payload is truncated, persist the full result beside the session. */
  spill?: ToolResultSpillContext;
};

const DEFAULT_MAX_CHARS = 16_000;

function estimateChars(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return String(value).length;
  }
}

function pickCraftDataFields(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const src = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    "taskId",
    "warning",
    "craftSignals",
    "gateDecision",
    "redlinePending",
    "deliveryReadiness",
    "clarificationQuestions",
    "code",
    "message",
  ] as const) {
    if (key in src) {
      out[key] = src[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pickKeyFields(result: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [
    "ok",
    "error",
    "code",
    "message",
    "pendingApproval",
    "needsMatter",
    "taskId",
    "path",
    "spillPath",
    "truncated",
    "aborted",
    "timedOut",
    "clarificationQuestions",
    "warning",
    "craftSignals",
    "gateDecision",
    "redlinePending",
  ] as const) {
    if (key in result) {
      out[key] = result[key];
    }
  }
  const nested = pickCraftDataFields(result.data);
  if (nested) {
    out.data = nested;
  }
  return out;
}

/**
 * Prepare a tool result for persistence in conversationHistory.
 * Over-budget payloads keep ok/error + key fields and mark truncated.
 */
export function summarizeToolResultForHistory(
  result: ToolCallResult,
  opts?: ToolResultHistoryOpts,
): ToolCallResult;
export function summarizeToolResultForHistory(
  result: unknown,
  opts?: ToolResultHistoryOpts,
): unknown;
export function summarizeToolResultForHistory(
  result: unknown,
  opts: ToolResultHistoryOpts = {},
): unknown {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    const raw = typeof result === "string" ? result : JSON.stringify(result);
    if ((raw?.length ?? 0) <= maxChars) {
      return result;
    }
    const spillPath = opts.spill ? writeToolResultSpill(opts.spill, result) : undefined;
    return {
      ok: false,
      truncated: true,
      error: "tool_result_truncated",
      message: spillPath
        ? `工具结果过长（约 ${raw?.length ?? 0} 字符），已截断。全文另存 ${spillPath}，需要细节时用 analyze_document 读取该路径。`
        : `工具结果过长（约 ${raw?.length ?? 0} 字符），已截断。请用专用工具按需重读。`,
      preview: String(raw).slice(0, Math.min(2_000, maxChars)),
      ...(spillPath ? { spillPath } : {}),
    };
  }

  const record = result as Record<string, unknown>;
  if (estimateChars(record) <= maxChars) {
    return result;
  }

  const slim = pickKeyFields(record);
  slim.truncated = true;
  const spillPath =
    typeof record.spillPath === "string" && record.spillPath.trim()
      ? record.spillPath.trim()
      : opts.spill
        ? writeToolResultSpill(opts.spill, result)
        : undefined;
  if (spillPath) {
    slim.spillPath = spillPath;
  }
  slim.message =
    typeof record.message === "string"
      ? record.message
      : spillPath
        ? `工具结果过长，已截断写入会话；全文另存 ${spillPath}，需要细节时用 analyze_document 读取该路径。`
        : "工具结果过长，已截断写入会话；完整细节请用工具重读。";
  // Keep a short preview of common text-bearing fields when present.
  for (const key of ["text", "content", "excerpt", "summary", "markdown"] as const) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) {
      slim[key] = v.slice(0, Math.min(4_000, Math.floor(maxChars / 3)));
      break;
    }
  }
  // Ensure ok/error survive even if missing from pick.
  if (!("ok" in slim) && "ok" in record) {
    slim.ok = record.ok;
  }
  if (!("error" in slim) && "error" in record) {
    slim.error = record.error;
  }
  return slim;
}

export function stringifyToolResultForHistory(
  result: unknown,
  opts: ToolResultHistoryOpts = {},
): string {
  return JSON.stringify(summarizeToolResultForHistory(result, opts));
}
