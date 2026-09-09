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

/**
 * CJK 字符在主流分词器下接近 1 字 ≈ 1 token；chars/4 对中文系统性低估 3-4 倍，
 * 会让 compact 触发过晚、存在上下文溢出风险。覆盖：CJK 符号与标点（　-〿）、
 * 平/片假名（぀-ヿ）、扩展 A（㐀-䶿）、统一表意文字（一-鿿）、兼容表意文字
 * （豈-﫿）、全角 forms（＀-￯）、韩文音节（가-힯），及代理对区间的扩展 B-F。
 */
const CJK_CHAR_RE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯가-힯\u{20000}-\u{2a6df}\u{2a700}-\u{2ebef}]/u;

/**
 * 混合文本 token 估算：CJK 按 1 token/字计，其余按 charsPerToken（默认 ~4 字符/token）
 * 分段求和。纯函数；for..of 按码点迭代，代理对汉字（扩展 B-F）按 1 字计。
 */
export function estimateTextTokens(
  text: string,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): number {
  const cpt = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
  let cjkChars = 0;
  let otherChars = 0;
  for (const ch of text) {
    if (CJK_CHAR_RE.test(ch)) {
      cjkChars++;
    } else {
      otherChars++;
    }
  }
  return cjkChars + Math.ceil(otherChars / cpt);
}

export type EstimateTokenBudgetOptions = {
  /** Selected model context window (catalog). */
  contextTokens?: number;
  charsPerToken?: number;
};

export function estimateMessageTokens(
  messages: AgentMessage[],
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): number {
  let tokens = 0;
  for (const msg of messages) {
    tokens += estimateTextTokens(msg.content ?? "", charsPerToken);
    if (msg.toolCalls?.length) {
      tokens += estimateTextTokens(JSON.stringify(msg.toolCalls), charsPerToken);
    }
    if (msg.toolCallResponses?.length) {
      tokens += estimateTextTokens(JSON.stringify(msg.toolCallResponses), charsPerToken);
    }
  }
  return tokens;
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
