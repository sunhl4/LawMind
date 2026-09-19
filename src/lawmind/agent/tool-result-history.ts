/**
 * Bound tool-result payloads written into session history so giant JSON
 * cannot consume the whole context window.
 *
 * Default budget is CJK-honest (~1k tokens), not 4k chars. ASCII ≈ 4 chars/token
 * so a 4k English blob still fits; a 3k 汉字 blob does not.
 */

import {
  formatSameTurnVerifyCodesReason,
  SAME_TURN_VERIFY_USER_PREFIX,
} from "../runtime/same-turn-verify.js";
import { estimateTextTokens } from "./context-budget.js";
import { writeToolResultSpill, type ToolResultSpillContext } from "./tool-result-spill.js";
import type { ToolCallResult } from "./types.js";

export type ToolResultHistoryOpts = {
  /**
   * Char budget for stringified JSON. When set, wins over `maxTokens`
   * (tests / overflow callers that still think in characters).
   */
  maxChars?: number;
  /** Token budget when `maxChars` is omitted (default: derived from `contextTokens`). */
  maxTokens?: number;
  /** Active chat model context window; the default budget scales with it. */
  contextTokens?: number;
  /** When set and the payload is truncated, persist the full result beside the session. */
  spill?: ToolResultSpillContext;
};

/**
 * 工具结果预算随模型上下文伸缩（默认 1/8 窗口，clamp [4k, 32k]；未知窗口回退 8k）。
 * 不写死小预算：模型越强，单条工具回包允许越大；超出部分走 spill + 截断提示，
 * 模型可按提示续读，不会无声丢内容。
 */
export const TOOL_RESULT_HISTORY_FALLBACK_TOKENS = 8_000;
export const TOOL_RESULT_HISTORY_MIN_TOKENS = 4_000;
export const TOOL_RESULT_HISTORY_MAX_TOKENS = 32_000;
export const TOOL_RESULT_HISTORY_CONTEXT_SHARE = 8;

/**
 * 运维可调的上限覆盖（对齐 Codex `tool_output_token_limit`）。
 * 硬编码的上限迟早会卡住某类真实工作；留一个不改代码就能调大的出口。
 */
export const TOOL_RESULT_TOKEN_LIMIT_ENV = "LAWMIND_TOOL_RESULT_TOKEN_LIMIT";

function envTokenLimitOverride(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env[TOOL_RESULT_TOKEN_LIMIT_ENV]?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.min(200_000, Math.max(1, Math.floor(parsed)));
}

export function resolveToolResultHistoryTokens(
  contextTokens?: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const override = envTokenLimitOverride(env);
  if (override !== undefined) {
    return override;
  }
  if (typeof contextTokens === "number" && Number.isFinite(contextTokens) && contextTokens > 0) {
    return Math.min(
      TOOL_RESULT_HISTORY_MAX_TOKENS,
      Math.max(
        TOOL_RESULT_HISTORY_MIN_TOKENS,
        Math.floor(contextTokens / TOOL_RESULT_HISTORY_CONTEXT_SHARE),
      ),
    );
  }
  return TOOL_RESULT_HISTORY_FALLBACK_TOKENS;
}

type ResolvedBudget = { kind: "chars"; maxChars: number } | { kind: "tokens"; maxTokens: number };

function resolveBudget(opts: ToolResultHistoryOpts): ResolvedBudget {
  if (typeof opts.maxChars === "number" && Number.isFinite(opts.maxChars) && opts.maxChars > 0) {
    return { kind: "chars", maxChars: Math.floor(opts.maxChars) };
  }
  const raw = opts.maxTokens ?? resolveToolResultHistoryTokens(opts.contextTokens);
  return { kind: "tokens", maxTokens: Math.max(1, Math.floor(raw)) };
}

function estimateChars(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return String(value).length;
  }
}

function isOverBudget(value: unknown, budget: ResolvedBudget): boolean {
  if (budget.kind === "chars") {
    return estimateChars(value) > budget.maxChars;
  }
  try {
    const json = JSON.stringify(value) ?? "";
    // Worst case is 1 token/char (all CJK). Skip the per-char walk when impossible.
    if (json.length <= budget.maxTokens) {
      return false;
    }
    return estimateTextTokens(json) > budget.maxTokens;
  } catch {
    return estimateTextTokens(String(value)) > budget.maxTokens;
  }
}

function primitiveOverBudget(raw: string, budget: ResolvedBudget): boolean {
  if (budget.kind === "chars") {
    return raw.length > budget.maxChars;
  }
  return estimateTextTokens(raw) > budget.maxTokens;
}

function clipTextToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return "";
  }
  if (estimateTextTokens(text) <= maxTokens) {
    return text;
  }
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTextTokens(text.slice(0, mid)) <= maxTokens) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo);
}

/** 取尾部 ≤ maxTokens 的后缀（Codex head_tail_buffer 的 tail 侧）。 */
function tailTextToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return "";
  }
  if (estimateTextTokens(text) <= maxTokens) {
    return text;
  }
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTextTokens(text.slice(text.length - mid)) <= maxTokens) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(text.length - lo);
}

/**
 * Codex `truncate_middle_with_token_budget` 式截断：头尾各留一半预算，中间标注
 * 省略量。法律文书的事实尾部（诉请/落款/签章）与开头同样重要，只留头会误导模型。
 */
export function clipTextToTokensMiddle(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return "";
  }
  const total = estimateTextTokens(text);
  if (total <= maxTokens) {
    return text;
  }
  const headBudget = Math.floor(maxTokens / 2);
  const tailBudget = maxTokens - headBudget;
  const head = clipTextToTokens(text, headBudget);
  const tail = tailTextToTokens(text, tailBudget);
  const omitted = Math.max(0, total - estimateTextTokens(head) - estimateTextTokens(tail));
  return `${head}\n…[中间省略约 ${omitted} tokens]…\n${tail}`;
}

function clipPreview(text: string, budget: ResolvedBudget): string {
  if (budget.kind === "chars") {
    const cap = Math.min(4_000, Math.floor(budget.maxChars / 3));
    if (text.length <= cap) {
      return text;
    }
    const headChars = Math.floor(cap / 2);
    return `${text.slice(0, headChars)}\n…[中间省略 ${text.length - cap} 字符]…\n${text.slice(text.length - (cap - headChars))}`;
  }
  return clipTextToTokensMiddle(text, Math.max(80, Math.floor(budget.maxTokens / 2)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Drop verify.message / gateDecision.reason when they duplicate `error`
 * (same-turn verify used to write the bounce envelope three times).
 * Keep issue rows so history can still reconstruct bounce codes.
 */
export function slimDuplicateVerifyFields(result: unknown): unknown {
  const record = asRecord(result);
  if (!record) {
    return result;
  }
  const error = typeof record.error === "string" ? record.error : "";
  if (!error) {
    return result;
  }
  const data = asRecord(record.data);
  if (!data) {
    return result;
  }
  let changed = false;
  const nextData = { ...data };
  const verify = asRecord(data.verify);
  if (verify && typeof verify.message === "string" && verify.message === error) {
    const nextVerify = { ...verify };
    delete nextVerify.message;
    nextData.verify = nextVerify;
    changed = true;
  }
  const gate = asRecord(data.gateDecision);
  if (gate && typeof gate.reason === "string" && gate.reason === error) {
    const codes = Array.isArray(verify?.codes)
      ? verify.codes.filter((c): c is string => typeof c === "string")
      : [];
    const nextTool = typeof verify?.nextTool === "string" ? verify.nextTool : undefined;
    nextData.gateDecision = {
      ...gate,
      reason: formatSameTurnVerifyCodesReason(codes, nextTool),
    };
    changed = true;
  }
  if (!changed) {
    return result;
  }
  return { ...record, data: nextData };
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
    "guardian",
    "redlinePending",
    "deliveryReadiness",
    "clarificationQuestions",
    "code",
    "message",
    "verify",
    "sameTurnVerify",
    "filePath",
    "fileRoot",
    "requestedPath",
    "offset",
    "limit",
    "hasMore",
    "nextOffset",
    "hint",
    "totalChars",
    "truncated",
    "sourceType",
    "bytes",
    "disclosedName",
    "disclosedNames",
    "alreadyAvailable",
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
    "approvalRequest",
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
    "guardian",
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

function clipBodyPreview(
  record: Record<string, unknown>,
  slim: Record<string, unknown>,
  budget: ResolvedBudget,
): void {
  for (const key of ["text", "content", "excerpt", "summary", "markdown"] as const) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) {
      slim[key] = clipPreview(v, budget);
      return;
    }
  }
  const data = asRecord(record.data);
  if (!data) {
    return;
  }
  for (const key of ["text", "content", "excerpt", "summary", "markdown"] as const) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) {
      slim.data = { ...asRecord(slim.data), [key]: clipPreview(v, budget) };
      return;
    }
  }
}

function clipErrorIfNeeded(error: unknown, budget: ResolvedBudget): unknown {
  if (typeof error !== "string" || !error) {
    return error;
  }
  if (error.startsWith(SAME_TURN_VERIFY_USER_PREFIX)) {
    return error;
  }
  if (budget.kind === "chars") {
    if (error.length <= budget.maxChars) {
      return error;
    }
    return error.slice(0, budget.maxChars);
  }
  if (estimateTextTokens(error) <= budget.maxTokens) {
    return error;
  }
  return clipTextToTokens(error, budget.maxTokens);
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
  const budget = resolveBudget(opts);
  const slimmedDup = slimDuplicateVerifyFields(result);
  if (slimmedDup == null || typeof slimmedDup !== "object" || Array.isArray(slimmedDup)) {
    const raw = typeof slimmedDup === "string" ? slimmedDup : JSON.stringify(slimmedDup);
    if (!primitiveOverBudget(raw ?? "", budget)) {
      return slimmedDup;
    }
    const spillPath = opts.spill ? writeToolResultSpill(opts.spill, result) : undefined;
    const preview =
      budget.kind === "chars"
        ? raw.slice(0, Math.min(2_000, budget.maxChars))
        : clipPreview(raw, budget);
    return {
      ok: false,
      truncated: true,
      error: "tool_result_truncated",
      message: spillPath
        ? `工具结果过长（约 ${raw?.length ?? 0} 字符），已截断。全文另存 ${spillPath}，需要细节时用 analyze_document 读取该路径。`
        : `工具结果过长（约 ${raw?.length ?? 0} 字符），已截断。请用专用工具按需重读。`,
      preview,
      ...(spillPath ? { spillPath } : {}),
    };
  }

  const record = slimmedDup as Record<string, unknown>;
  if (!isOverBudget(record, budget)) {
    return slimmedDup;
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
  clipBodyPreview(record, slim, budget);
  if (!("ok" in slim) && "ok" in record) {
    slim.ok = record.ok;
  }
  if (!("error" in slim) && "error" in record) {
    slim.error = record.error;
  }
  if ("error" in slim) {
    slim.error = clipErrorIfNeeded(slim.error, budget);
  }
  return slim;
}

export function stringifyToolResultForHistory(
  result: unknown,
  opts: ToolResultHistoryOpts = {},
): string {
  return JSON.stringify(summarizeToolResultForHistory(result, opts));
}
