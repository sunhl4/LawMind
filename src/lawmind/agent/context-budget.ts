import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { isCompactSyntheticUserMessage } from "./compact-insert.js";
import type { AgentMessage, AgentSession } from "./types.js";
import { WORLD_STATE_SECTION_IDS } from "./world-state.js";

export type TokenBudgetLevel = "ok" | "warn" | "compact";

export type TokenBudgetSnapshot = {
  used: number;
  effectiveLimit: number;
  level: TokenBudgetLevel;
};

const DEFAULT_CONTEXT_TOKENS = 128_000;
const DEFAULT_CHARS_PER_TOKEN = 4;
/** Inject remaining-token notes / compact-warn only past this fill ratio. */
export const TOKEN_BUDGET_WARN_RATIO = 0.85;
/**
 * 回合内（工具轮边界）自动压缩的触发线：有效窗口的比例（Codex 用 90%）。
 * 回合开始的压缩仍按 `level === "compact"` 触发；回合内提前一点压，
 * 免得模型先看到「先收口」而把活儿退回律师。
 */
export const DEFAULT_MID_TURN_COMPACT_TRIGGER_RATIO = 0.9;

/**
 * 小窗口的预留上限（占窗口比例）。有效窗口 = 窗口 − 摘要输出预留 − 压缩缓冲；
 * 两者写死 20k/13k 时，32k 窗口只剩 8k 可用，回合内压缩就腾不出空间了。
 */
export const SMALL_WINDOW_RESERVE_RATIO = 0.25;

/**
 * CJK 字符在主流分词器下接近 1 字 ≈ 1 token；chars/4 对中文系统性低估 3-4 倍，
 * 会让 compact 触发过晚、存在上下文溢出风险。覆盖：CJK 符号与标点（U+3000–U+303F）、
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
    tokens += estimateSingleMessageTokens(msg, charsPerToken);
  }
  return tokens;
}

function estimateSingleMessageTokens(
  msg: AgentMessage,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): number {
  let tokens = estimateTextTokens(msg.content ?? "", charsPerToken);
  if (msg.toolCalls?.length) {
    tokens += estimateTextTokens(JSON.stringify(msg.toolCalls), charsPerToken);
  }
  if (msg.toolCallResponses?.length) {
    tokens += estimateTextTokens(JSON.stringify(msg.toolCallResponses), charsPerToken);
  }
  return tokens;
}

/**
 * 上下文用量的**分层**口径（Cursor 的 context breakdown / Codex `/status` 的对应物）。
 *
 * 只按「律师看得懂、且能自己去动」的分层切，不试图复刻分词器：
 * - `rules` / `workspace` / `pins` / `plan` / `craft`：系统提示里各段（世界状态按 id 拆开，
 *   因为钉选材料、清单、红线重注是律师会主动增删的东西）；
 * - `turnContext`：本轮追加的尾部（案件索引等）；
 * - `lawyer` / `assistant` / `toolResults`：会话三方；
 * - `digest`：压缩蒸馏与锚点（合成消息，不是律师真说过的话）。
 *
 * 纯函数；估算口径与 {@link estimateMessageTokens} 完全一致，各桶之和恒等于
 * `estimateTokenBudget(...).used`（本函数不含 `samplingPromptTail` 时相等）。
 */
export type TokenBudgetBucketId =
  | "rules"
  | "workspace"
  | "pins"
  | "plan"
  | "craft"
  | "turnContext"
  | "lawyer"
  | "assistant"
  | "toolResults"
  | "digest";

/** 展示顺序：律师侧 → 助手侧 → 工具 → 系统层。 */
export const TOKEN_BUDGET_BUCKET_ORDER: readonly TokenBudgetBucketId[] = [
  "lawyer",
  "assistant",
  "toolResults",
  "digest",
  "turnContext",
  "pins",
  "plan",
  "craft",
  "workspace",
  "rules",
] as const;

export type TokenBudgetBreakdown = {
  buckets: Array<{ id: TokenBudgetBucketId; tokens: number }>;
  total: number;
};

/** 世界状态段 → 分层桶。未列出的段（policy/deliverable/permission/matter）归 `workspace`。 */
const WORLD_STATE_BUCKET: Partial<Record<string, TokenBudgetBucketId>> = {
  pins: "pins",
  plan: "plan",
  craft: "craft",
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 整段（含 `<!--lm-ws:id-->` 标记）在正文里的原始文本；标记开销归该段自己。 */
function worldStateSpan(content: string, id: string): string | undefined {
  const pattern = new RegExp(
    `${escapeRegExp(`<!--lm-ws:${id}-->`)}\\n?([\\s\\S]*?)\\n?${escapeRegExp(`<!--/lm-ws:${id}-->`)}`,
  );
  return pattern.exec(content)?.[0];
}

function systemContentBuckets(
  content: string,
  charsPerToken: number,
): Map<TokenBudgetBucketId, number> {
  const out = new Map<TokenBudgetBucketId, number>();
  const contentTokens = estimateTextTokens(content, charsPerToken);
  let sectionTokens = 0;
  for (const id of WORLD_STATE_SECTION_IDS) {
    const span = worldStateSpan(content, id);
    if (!span) {
      continue;
    }
    const tokens = estimateTextTokens(span, charsPerToken);
    sectionTokens += tokens;
    const bucket = WORLD_STATE_BUCKET[id] ?? "workspace";
    out.set(bucket, (out.get(bucket) ?? 0) + tokens);
  }
  // 残余用「整段 tokens − 各段 tokens」算，而不是重新分词残余文本：
  // 这样各桶之和与 {@link estimateMessageTokens} 严格一致（换行/标记不引入漂移）。
  const rulesTokens = Math.max(0, contentTokens - sectionTokens);
  if (rulesTokens > 0) {
    out.set("rules", (out.get("rules") ?? 0) + rulesTokens);
  }
  return out;
}

export function estimateTokenBudgetBreakdown(
  session: AgentSession,
  opts?: { charsPerToken?: number },
): TokenBudgetBreakdown {
  const charsPerToken = opts?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  const totals = new Map<TokenBudgetBucketId, number>();
  const add = (id: TokenBudgetBucketId, tokens: number): void => {
    if (tokens > 0) {
      totals.set(id, (totals.get(id) ?? 0) + tokens);
    }
  };

  for (const msg of session.conversationHistory) {
    if (msg.role === "system") {
      const parts = systemContentBuckets(msg.content ?? "", charsPerToken);
      // 系统消息上挂的 tool_calls / toolCallResponses（罕见）仍归系统层。
      const residual =
        estimateSingleMessageTokens(msg, charsPerToken) -
        estimateTextTokens(msg.content ?? "", charsPerToken);
      for (const [id, tokens] of parts) {
        add(id, tokens);
      }
      add("rules", residual);
      continue;
    }
    const tokens = estimateSingleMessageTokens(msg, charsPerToken);
    if (msg.role === "user") {
      add(isCompactSyntheticUserMessage(msg.content ?? "") ? "digest" : "lawyer", tokens);
      continue;
    }
    if (msg.role === "assistant") {
      add("assistant", tokens);
      continue;
    }
    if (msg.role === "tool") {
      add("toolResults", tokens);
      continue;
    }
    add("assistant", tokens);
  }

  const tail = session.samplingPromptTail?.trim();
  if (tail) {
    add("turnContext", estimateTextTokens(tail, charsPerToken));
  }

  const buckets = TOKEN_BUDGET_BUCKET_ORDER.map((id) => ({ id, tokens: totals.get(id) ?? 0 }));
  const total = buckets.reduce((n, b) => n + b.tokens, 0);
  return { buckets, total };
}

export function resolveContextPolicy(policy: LawMindWorkspacePolicy | null | undefined): {
  autoCompactBufferTokens: number;
  maxConsecutiveCompactFailures: number;
  summaryOutputTokenReserve: number;
  midTurnCompactTriggerRatio: number;
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
    midTurnCompactTriggerRatio:
      typeof ctx?.midTurnCompactTriggerRatio === "number" &&
      ctx.midTurnCompactTriggerRatio > 0 &&
      ctx.midTurnCompactTriggerRatio <= 1
        ? ctx.midTurnCompactTriggerRatio
        : DEFAULT_MID_TURN_COMPACT_TRIGGER_RATIO,
  };
}

export function estimateTokenBudget(
  session: AgentSession,
  policy?: LawMindWorkspacePolicy | null,
  opts?: EstimateTokenBudgetOptions,
): TokenBudgetSnapshot {
  const { autoCompactBufferTokens, summaryOutputTokenReserve } = resolveContextPolicy(policy);
  const charsPerToken = opts?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  let used = estimateMessageTokens(session.conversationHistory, charsPerToken);
  if (session.samplingPromptTail?.trim()) {
    used += estimateTextTokens(session.samplingPromptTail, charsPerToken);
  }
  const contextTokens = Math.max(
    8_000,
    opts?.contextTokens ??
      (typeof policy?.context?.contextTokens === "number"
        ? policy.context.contextTokens
        : DEFAULT_CONTEXT_TOKENS),
  );
  // 预留随窗口缩放（Codex 的 effective window 教训 #40095）：写死 20k+13k 时，
  // 32k 窗口只剩 8k 可用——回合内压缩腾不出空间，模型只能把活儿退回律师。
  // 小窗口按窗口比例封顶预留，大窗口保持既有绝对值（行为不变）。
  const configuredReserve = summaryOutputTokenReserve + autoCompactBufferTokens;
  const reserve = Math.min(
    configuredReserve,
    Math.floor(contextTokens * SMALL_WINDOW_RESERVE_RATIO),
  );
  const effectiveLimit = Math.max(8_000, contextTokens - reserve);
  const ratio = used / effectiveLimit;
  let level: TokenBudgetLevel = "ok";
  if (ratio >= 1) {
    level = "compact";
  } else if (ratio >= TOKEN_BUDGET_WARN_RATIO) {
    level = "warn";
  }
  return { used, effectiveLimit, level };
}
