/**
 * Overflow recovery: shrink already-written tool results without dropping
 * tool-call / tool-result pairing. No LLM summary.
 *
 * 写入历史时的预算（约窗口的 1/8）不能再拿来做溢出抢救：回包已经按那个上限
 * 截过，同预算再剪一次是空操作，溢出重试随即失败。抢救必须用更紧的预算，
 * 并且留住最近几条回包，避免模型丢掉刚读到的材料。
 */

import {
  stringifyToolResultForHistory,
  summarizeToolResultForHistory,
} from "./tool-result-history.js";
import type { AgentMessage, AgentSession, ToolCallResult } from "./types.js";

export function isContextOverflowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    /context_length_exceeded|maximum context length|prompt is too long|too many tokens|context window|context overflow|token limit|requested .+ tokens/i.test(
      lower,
    ) || /上下文.*(过长|超|满|溢出)/.test(msg)
  );
}

function parseToolContent(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

/**
 * 上下文溢出后的抢救预算。必须明显小于写入上限（最小 4k），否则剪不动。
 * 头尾截断仍由 `summarizeToolResultForHistory` 完成，事实尾部不会被整段丢掉。
 */
export const OVERFLOW_PRUNE_MAX_TOKENS = 1_200;
/** 溢出抢救时保留的最近工具回包条数（刚读到的材料不先砍）。 */
export const OVERFLOW_PRUNE_KEEP_RECENT = 2;
/**
 * 回合中段先瘦旧回包、再考虑整段压缩。比写入预算紧，但比溢出抢救松，
 * 避免一越线就把还能用的检索结果削成标题。
 */
export const MID_TURN_PRUNE_MAX_TOKENS = 2_000;
export const MID_TURN_PRUNE_KEEP_RECENT = 4;

export type PruneToolResultsOpts = {
  maxChars?: number;
  maxTokens?: number;
  /** 从尾部数，这么多条 tool 消息保持原样。 */
  keepRecent?: number;
};

function recentToolIndexes(messages: AgentMessage[], keepRecent: number): Set<number> {
  const keep = new Set<number>();
  if (keepRecent <= 0) {
    return keep;
  }
  let left = keepRecent;
  for (let i = messages.length - 1; i >= 0 && left > 0; i -= 1) {
    if (messages[i]?.role === "tool") {
      keep.add(i);
      left -= 1;
    }
  }
  return keep;
}

export function pruneToolResultsInHistory(
  messages: AgentMessage[],
  opts?: PruneToolResultsOpts,
): { messages: AgentMessage[]; prunedCount: number; charsRemoved: number } {
  const historyOpts =
    typeof opts?.maxChars === "number"
      ? { maxChars: opts.maxChars }
      : typeof opts?.maxTokens === "number"
        ? { maxTokens: opts.maxTokens }
        : {};
  const keep =
    typeof opts?.keepRecent === "number" && opts.keepRecent > 0
      ? recentToolIndexes(messages, Math.floor(opts.keepRecent))
      : undefined;
  let prunedCount = 0;
  let charsRemoved = 0;
  const next = messages.map((msg, index) => {
    if (msg.role !== "tool" || keep?.has(index)) {
      return msg;
    }
    const before = msg.content?.length ?? 0;
    const source =
      msg.toolCallResponses?.[0]?.result ??
      (msg.content ? parseToolContent(msg.content) : undefined);
    if (source == null) {
      return msg;
    }
    const slim = summarizeToolResultForHistory(source, historyOpts);
    const content = stringifyToolResultForHistory(slim, historyOpts);
    if (content.length >= before) {
      return msg;
    }
    prunedCount += 1;
    charsRemoved += before - content.length;
    return {
      ...msg,
      content,
      toolCallResponses: msg.toolCallResponses?.map((tr) => ({
        ...tr,
        result: slim as ToolCallResult,
      })),
    };
  });
  return { messages: next, prunedCount, charsRemoved };
}

export function pruneSessionToolResults(
  session: AgentSession,
  opts?: PruneToolResultsOpts,
): { prunedCount: number; charsRemoved: number } {
  const result = pruneToolResultsInHistory(session.conversationHistory, opts);
  if (result.prunedCount === 0) {
    return { prunedCount: 0, charsRemoved: 0 };
  }
  session.conversationHistory = result.messages;
  return { prunedCount: result.prunedCount, charsRemoved: result.charsRemoved };
}
