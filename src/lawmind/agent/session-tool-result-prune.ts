/**
 * Overflow recovery: shrink already-written tool results without dropping
 * tool-call / tool-result pairing. No LLM summary.
 * Default budget is the same CJK-honest ~1k token cap as history writes.
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

export function pruneToolResultsInHistory(
  messages: AgentMessage[],
  opts?: { maxChars?: number; maxTokens?: number },
): { messages: AgentMessage[]; prunedCount: number; charsRemoved: number } {
  const historyOpts =
    typeof opts?.maxChars === "number"
      ? { maxChars: opts.maxChars }
      : typeof opts?.maxTokens === "number"
        ? { maxTokens: opts.maxTokens }
        : {};
  let prunedCount = 0;
  let charsRemoved = 0;
  const next = messages.map((msg) => {
    if (msg.role !== "tool") {
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
  opts?: { maxChars?: number; maxTokens?: number },
): { prunedCount: number; charsRemoved: number } {
  const result = pruneToolResultsInHistory(session.conversationHistory, opts);
  if (result.prunedCount === 0) {
    return { prunedCount: 0, charsRemoved: 0 };
  }
  session.conversationHistory = result.messages;
  return { prunedCount: result.prunedCount, charsRemoved: result.charsRemoved };
}
