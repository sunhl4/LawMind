/**
 * Bound tool-result payloads written into session history so giant JSON
 * cannot consume the whole context window.
 */

import type { ToolCallResult } from "./types.js";

export type ToolResultHistoryOpts = {
  /** Soft char budget for stringified tool content (default 16k ≈ 4k tokens @ chars/4). */
  maxChars?: number;
};

const DEFAULT_MAX_CHARS = 16_000;

function estimateChars(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return String(value).length;
  }
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
    "truncated",
    "clarificationQuestions",
  ] as const) {
    if (key in result) {
      out[key] = result[key];
    }
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
    return {
      ok: false,
      truncated: true,
      error: "tool_result_truncated",
      message: `工具结果过长（约 ${raw?.length ?? 0} 字符），已截断。请用专用工具按需重读。`,
      preview: String(raw).slice(0, Math.min(2_000, maxChars)),
    };
  }

  const record = result as Record<string, unknown>;
  if (estimateChars(record) <= maxChars) {
    return result;
  }

  const slim = pickKeyFields(record);
  slim.truncated = true;
  slim.message =
    typeof record.message === "string"
      ? record.message
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
