/**
 * 单一事实源：一次文档读取能进入模型可见上下文的字符预算。
 *
 * 三条读取路径（analyze_document / read_project_file / read_folder_documents）
 * 曾经各自写死默认页（8k / 40k / 8k），同一个文件换个工具看到的量差数倍，且大页
 * 注定被工具结果管线裁剪——模型只看到碎片却以为读完了。这里统一：
 *
 *   预算 = 工具结果预算 × 0.8（CJK 1 字≈1 token 保守折算），clamp [8k, 40k]
 *   页大小 = 预算 − 防注入横幅开销（保证「整包 payload」正好装进预算）
 *
 * 超出部分一律用 offset/nextOffset 续读，不靠静默裁剪。窗口未知时回退 8k。
 */

import { wrapUntrustedDocumentContent } from "../platform/content-trust.js";
import { resolveToolResultHistoryTokens } from "./tool-result-history.js";

/** 单次读取占工具结果预算的比例（留 20% 给 JSON 包装与同轮其他工具）。 */
export const DOCUMENT_READ_BUDGET_RATIO = 0.8;
export const DOCUMENT_READ_MIN_CHARS = 8_000;
export const DOCUMENT_READ_MAX_CHARS = 40_000;

/**
 * 防注入横幅的固定字符开销（首尾包裹），由实际包裹函数计算，不会与文案漂移。
 * 用于从预算中扣减，使整包 payload（横幅+正文）正好等于预算。
 */
export const UNTRUSTED_WRAPPER_OVERHEAD_CHARS = wrapUntrustedDocumentContent("").length;

/**
 * 单次读取（含批量总量）可进入模型可见上下文的正文字符预算。
 * 不扣横幅：调用方按是否逐条包裹自行决定扣减。
 *
 * 硬约束：返回值永不大于工具结果预算 `resolveToolResultHistoryTokens`。
 * 小窗口（如 16k 上下文 → 工具结果预算 4k）下，8k 保底若不放会让页面
 * 注定被裁剪，因此保底值也要让位于该约束。
 */
export function resolveDocumentReadBudgetChars(contextTokens?: number): number {
  const tokenBudget = resolveToolResultHistoryTokens(contextTokens);
  const cap = Math.min(DOCUMENT_READ_MAX_CHARS, tokenBudget);
  const target = Math.max(
    DOCUMENT_READ_MIN_CHARS,
    Math.floor(tokenBudget * DOCUMENT_READ_BUDGET_RATIO),
  );
  return Math.max(1, Math.min(cap, target));
}

/**
 * 单文件默认页大小。
 * `overheadChars` 默认扣掉防注入横幅；批量工具逐条包裹时也应传入实际开销，
 * 不包裹（只在回包顶部给一次提示）则传 0。
 */
export function resolveDocumentPageChars(
  contextTokens?: number,
  opts?: { overheadChars?: number },
): number {
  const budget = resolveDocumentReadBudgetChars(contextTokens);
  const overhead = opts?.overheadChars ?? UNTRUSTED_WRAPPER_OVERHEAD_CHARS;
  return Math.max(1, budget - Math.max(0, overhead));
}

/** 批量读取时单个文件的最低配额：低于此值连案号/当事人一行都读不全。 */
export const FOLDER_PER_FILE_FLOOR_CHARS = 2_000;

/**
 * 批量读取时每个文件的配额。
 *
 * 按**实际文件数**公平分配（而不是固定取一半）：一个材料夹里多数是短文书
 * （送达回证、证据清单、身份证），按文件数分配能让它们**整篇通过、不被截断**，
 * 只有真正超长的文书才走中间省略。文件很多时保底 {FOLDER_PER_FILE_FLOOR_CHARS}，
 * 于是单次调用能覆盖更多文件，而不是把预算全给第一个文件。
 */
export function resolveFolderPerFileChars(contextTokens?: number, fileCount?: number): number {
  const budget = resolveDocumentReadBudgetChars(contextTokens);
  const count = Math.max(1, Math.floor(fileCount ?? 1));
  const share = Math.floor(budget / count);
  return Math.min(budget, Math.max(FOLDER_PER_FILE_FLOOR_CHARS, share));
}
