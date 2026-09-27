import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { isCompactSyntheticUserMessage } from "./compact-insert.js";
import { DEFAULT_CONTEXT_TUNING, resolveContextTuning } from "./context-tuning.js";
import type { AgentMessage, AgentSession } from "./types.js";
import { WORLD_STATE_SECTION_IDS } from "./world-state.js";

export {
  resolveContextPolicy,
  SMALL_WINDOW_RESERVE_RATIO,
  TOKEN_BUDGET_WARN_RATIO,
} from "./context-tuning.js";

export type TokenBudgetLevel = "ok" | "warn" | "compact";

export type TokenBudgetSnapshot = {
  used: number;
  effectiveLimit: number;
  level: TokenBudgetLevel;
  /** 追加注记 / warn 的起始填充比（随 policy 变化；调用方不必再自己读 policy）。 */
  warnRatio: number;
};

const DEFAULT_CONTEXT_TOKENS = DEFAULT_CONTEXT_TUNING.budget.contextTokens;
const DEFAULT_CHARS_PER_TOKEN = 4;

/**
 * 历史质量带的名义窗口，等于对话长度 200K 档。
 * 整理线、尾巴预算、蒸馏帽都按它封顶，不随 500K / 1M 放大。
 * 模型自己的窗口更短时仍以模型为准。单条工具回包预算不走这里。
 */
export const HISTORY_QUALITY_CONTEXT_TOKENS = 200_000;

export function historyContextTokens(modelContextTokens: number): number {
  if (!Number.isFinite(modelContextTokens) || modelContextTokens <= 0) {
    return modelContextTokens;
  }
  return Math.min(Math.floor(modelContextTokens), HISTORY_QUALITY_CONTEXT_TOKENS);
}

/**
 * 历史预算用的名义窗口。水位、蒸馏帽、工具回包都从这里出发，
 * 不再各自对 1M 再乘一次。
 */
export function historyNominalTokens(
  modelContextTokens: number | undefined,
  opts: { minContextTokens: number; fallbackTokens: number },
): number {
  const requested =
    typeof modelContextTokens === "number" &&
    Number.isFinite(modelContextTokens) &&
    modelContextTokens > 0
      ? modelContextTokens
      : opts.fallbackTokens;
  return Math.max(opts.minContextTokens, historyContextTokens(requested));
}

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
 *   因为钉选材料、清单、红线重注是律师会主动增删的东西）；强制规则按标题另计，不跟系统说明混在一起；
 * - `tools`：本轮「可用工具 / 可按需启用」清单（会随披露变化，律师用用量解释「为什么突然变大」）；
 * - `system`：身份、流程、安全边界等固定说明（律师改不了，单独占一桶以免被误当成规则）；
 * - `turnContext`：本轮追加的尾部，以及系统提示里的当前案件 / 今日记录；
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
  | "digest"
  | "tools"
  | "system";

/** 展示顺序：律师侧 → 助手侧 → 可删的上下文 → 固定系统说明。 */
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
  "tools",
  "system",
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

/**
 * 系统提示里按标题切开、且律师能对上「这桶为什么大」的段。
 * 标题必须是行首 `## `，切到下一个同级标题为止。
 */
const HEADING_BUCKETS: ReadonlyArray<{ heading: string; bucket: TokenBudgetBucketId }> = [
  { heading: "## 可用工具", bucket: "tools" },
  { heading: "## 可按需启用", bucket: "tools" },
  { heading: "## 当前案件", bucket: "turnContext" },
  { heading: "## 今日工作记录", bucket: "turnContext" },
  { heading: "## 工作区强制规则", bucket: "rules" },
  { heading: "## 本案强制规则", bucket: "rules" },
];

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

/** 从行首标题切到下一个 `## `；标题不在行首则忽略，避免正文里的引用被算进去。 */
function headingSpan(content: string, heading: string): string | undefined {
  const atStart = content.startsWith(heading);
  const markerAt = atStart ? 0 : content.indexOf(`\n${heading}`);
  if (markerAt < 0) {
    return undefined;
  }
  const from = atStart ? 0 : markerAt + 1;
  const rest = content.slice(from + heading.length);
  const next = rest.search(/\n## /);
  const end = next < 0 ? content.length : from + heading.length + next;
  return content.slice(from, end);
}

function systemContentBuckets(
  content: string,
  charsPerToken: number,
): Map<TokenBudgetBucketId, number> {
  const out = new Map<TokenBudgetBucketId, number>();
  const contentTokens = estimateTextTokens(content, charsPerToken);
  let sectionTokens = 0;
  const occupied: Array<{ start: number; end: number }> = [];
  for (const id of WORLD_STATE_SECTION_IDS) {
    const span = worldStateSpan(content, id);
    if (!span) {
      continue;
    }
    const start = content.indexOf(span);
    if (start >= 0) {
      occupied.push({ start, end: start + span.length });
    }
    const tokens = estimateTextTokens(span, charsPerToken);
    sectionTokens += tokens;
    const bucket = WORLD_STATE_BUCKET[id] ?? "workspace";
    out.set(bucket, (out.get(bucket) ?? 0) + tokens);
  }
  for (const { heading, bucket } of HEADING_BUCKETS) {
    const span = headingSpan(content, heading);
    if (!span) {
      continue;
    }
    const start = content.indexOf(span);
    if (occupied.some((range) => start >= range.start && start < range.end)) {
      continue;
    }
    const tokens = estimateTextTokens(span, charsPerToken);
    sectionTokens += tokens;
    out.set(bucket, (out.get(bucket) ?? 0) + tokens);
  }
  // 残余用「整段 tokens − 各段 tokens」算，而不是重新分词残余文本：
  // 这样各桶之和与 {@link estimateMessageTokens} 严格一致（换行/标记不引入漂移）。
  // 残余是身份、流程、安全边界等固定说明，不是律师可改的强制规则。
  const systemTokens = Math.max(0, contentTokens - sectionTokens);
  if (systemTokens > 0) {
    out.set("system", (out.get("system") ?? 0) + systemTokens);
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
      add("system", residual);
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

export function estimateTokenBudget(
  session: AgentSession,
  policy?: LawMindWorkspacePolicy | null,
  opts?: EstimateTokenBudgetOptions,
): TokenBudgetSnapshot {
  const tuning = resolveContextTuning(policy).budget;
  const charsPerToken = opts?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  let used = estimateMessageTokens(session.conversationHistory, charsPerToken);
  if (session.samplingPromptTail?.trim()) {
    used += estimateTextTokens(session.samplingPromptTail, charsPerToken);
  }
  const contextTokens = historyNominalTokens(opts?.contextTokens, {
    minContextTokens: tuning.minContextTokens,
    fallbackTokens: tuning.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
  });
  // 预留随窗口缩放（Codex 的 effective window 教训 #40095）：写死 20k+13k 时，
  // 32k 窗口只剩 8k 可用——回合内压缩腾不出空间，模型只能把活儿退回律师。
  // 小窗口按窗口比例封顶预留，大窗口保持既有绝对值（行为不变）。
  const configuredReserve = tuning.summaryOutputTokenReserve + tuning.autoCompactBufferTokens;
  const reserve = Math.min(
    configuredReserve,
    Math.floor(contextTokens * tuning.smallWindowReserveRatio),
  );
  const effectiveLimit = Math.max(tuning.minEffectiveLimitTokens, contextTokens - reserve);
  const ratio = used / effectiveLimit;
  let level: TokenBudgetLevel = "ok";
  if (ratio >= 1) {
    level = "compact";
  } else if (ratio >= tuning.warnRatio) {
    level = "warn";
  }
  return { used, effectiveLimit, level, warnRatio: tuning.warnRatio };
}
