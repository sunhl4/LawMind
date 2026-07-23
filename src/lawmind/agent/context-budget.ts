import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import type { AgentMessage, AgentSession } from "./types.js";

export type TokenBudgetLevel = "ok" | "warn" | "compact";

export type TokenBudgetSnapshot = {
  used: number;
  effectiveLimit: number;
  level: TokenBudgetLevel;
};

const DEFAULT_CONTEXT_TOKENS = 128_000;
const DEFAULT_CHARS_PER_TOKEN = 4;

export type EstimateTokenBudgetOptions = {
  /** Selected model context window (catalog). */
  contextTokens?: number;
  charsPerToken?: number;
};

export function estimateMessageTokens(
  messages: AgentMessage[],
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): number {
  const cpt = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
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
  return Math.ceil(chars / cpt);
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
  opts?: EstimateTokenBudgetOptions,
): TokenBudgetSnapshot {
  const { autoCompactBufferTokens, summaryOutputTokenReserve } = resolveContextPolicy(policy);
  const charsPerToken = opts?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  const used = estimateMessageTokens(session.conversationHistory, charsPerToken);
  const contextTokens = Math.max(
    8_000,
    opts?.contextTokens ??
      (typeof policy?.context?.contextTokens === "number"
        ? policy.context.contextTokens
        : DEFAULT_CONTEXT_TOKENS),
  );
  const effectiveLimit = Math.max(
    8_000,
    contextTokens - summaryOutputTokenReserve - autoCompactBufferTokens,
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
