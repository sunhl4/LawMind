import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import type { AgentMessage, AgentSession } from "./types.js";

export type TokenBudgetLevel = "ok" | "warn" | "compact";

export type TokenBudgetSnapshot = {
  used: number;
  effectiveLimit: number;
  level: TokenBudgetLevel;
};

const DEFAULT_EFFECTIVE_LIMIT = 128_000;
const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateMessageTokens(messages: AgentMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    chars += (msg.content ?? "").length;
    if (msg.toolCalls?.length) {
      chars += JSON.stringify(msg.toolCalls).length;
    }
    if (msg.toolCallResponses?.length) {
      chars += JSON.stringify(msg.toolCallResponses).length;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

export function resolveContextPolicy(policy: LawMindWorkspacePolicy | null | undefined): {
  autoCompactBufferTokens: number;
  maxConsecutiveCompactFailures: number;
  summaryOutputTokenReserve: number;
} {
  const ctx = policy?.context;
  return {
    autoCompactBufferTokens:
      typeof ctx?.autoCompactBufferTokens === "number" ? ctx.autoCompactBufferTokens : 13_000,
    maxConsecutiveCompactFailures:
      typeof ctx?.maxConsecutiveCompactFailures === "number"
        ? ctx.maxConsecutiveCompactFailures
        : 3,
    summaryOutputTokenReserve:
      typeof ctx?.summaryOutputTokenReserve === "number" ? ctx.summaryOutputTokenReserve : 20_000,
  };
}

export function estimateTokenBudget(
  session: AgentSession,
  policy?: LawMindWorkspacePolicy | null,
): TokenBudgetSnapshot {
  const { autoCompactBufferTokens, summaryOutputTokenReserve } = resolveContextPolicy(policy);
  const used = estimateMessageTokens(session.conversationHistory);
  const effectiveLimit = Math.max(
    8_000,
    DEFAULT_EFFECTIVE_LIMIT - summaryOutputTokenReserve - autoCompactBufferTokens,
  );
  const ratio = used / effectiveLimit;
  let level: TokenBudgetLevel = "ok";
  if (ratio >= 1) {
    level = "compact";
  } else if (ratio >= 0.85) {
    level = "warn";
  }
  return { used, effectiveLimit, level };
}
