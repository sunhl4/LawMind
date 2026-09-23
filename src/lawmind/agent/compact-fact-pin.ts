/**
 * 事实台账（fact pin）——把**律师原话里的关键事实**钉住，跨任意次压缩原样存活。
 *
 * ## 为什么任务钉子不够
 *
 * 任务钉子（`taskPin`）只保「要做什么」。压缩保真度基准实测出的下一条缺口是：
 * **期限 / 金额 / 引用 / 硬约束在第 1 轮就随要点窗口一起丢了**——
 * 律师说过「劳动仲裁申请时效是一年」，压一轮之后模型手里就没有这句话了。
 * 对法律工作来说，丢期限是事故（误期 = 执业风险），丢硬约束会直接把交付做反
 * （「不要把保密义务一起解除」丢了，模型就可能真去解除）。
 *
 * ## 三条设计原则
 *
 * 1. **只钉律师原话（verbatim），不做任何推导。** 钉错一条事实比漏一条更糟：
 *    漏了模型还有机会重读案卷；钉错就成了「系统声称律师这么说过」。
 *    所以这里只做**模式识别 + 整句原样保留**，从不改写、从不补全、从不计算。
 * 2. **宁缺毋滥。** 模式要够窄（期限 / 金额 / 法条引用 / 硬约束四类明确特征），
 *    疑问句不进台账（「是否必须…？」不是约束）。
 * 3. **有界。** 条数与总字符双帽 + 去重 + 固定优先级，避免把系统段养成第二个上下文。
 *    优先级：期限 > 硬约束 > 引用 > 金额——按「丢了哪一类最像事故」排。
 *
 * ## 与 `taskPin` 一致的存活机制
 *
 * 台账写进重注块 → `system[0]` 的 world-state 段。压缩只保留 `system[0]`，
 * 因此它**不参与摘要、不被截断、也不随压缩层数衰减**。
 */

import { collectDroppedCitationAnchors } from "./compact.js";
import { type ContextPinsTuning, resolveContextTuning } from "./context-tuning.js";
import type { AgentMessage } from "./types.js";

export type FactPinKind = "deadline" | "constraint" | "citation" | "amount";

export type FactPinItem = {
  id: string;
  kind: FactPinKind;
  /** 律师原话的**整句**（不是抽出来的数字/词），便于模型直接引用。 */
  text: string;
  at: string;
};

/**
 * 台账帽（条数 / 单条 / 总量）。默认值集中在 `context-tuning.ts`；
 * 可调 `context.pins.factMaxItems` / `factItemCharCap` / `factTotalCharCap`。
 */
export {
  FACT_PIN_MAX_ITEMS,
  FACT_PIN_ITEM_CHAR_CAP,
  FACT_PIN_TOTAL_CHAR_CAP,
} from "./context-tuning.js";

function capsOf(tuning?: ContextPinsTuning): ContextPinsTuning {
  return tuning ?? resolveContextTuning(null).pins;
}

/**
 * 优先级：丢了哪一类最像事故。
 * 期限（误期 = 执业风险）> 硬约束（做反了要重做）> 引用（错引 = 错误交付）> 金额。
 */
const KIND_PRIORITY: Record<FactPinKind, number> = {
  deadline: 0,
  constraint: 1,
  citation: 2,
  amount: 3,
};

/** 期限 / 时效的**主题词**：只说「期限」还不够（「核对期限与金额」不是期限事实）。 */
const DEADLINE_TOPIC_RE = /(?:时效|期限|期间|届满|举证期限|上诉期|答辩期|履行期|宽限期|除斥期间)/;

/**
 * 时间**量词 / 起算表述**：期限事实必须落到具体时间，否则不钉。
 *
 * 为什么要这一条（实测踩过）：最初只看主题词，于是填充语「逐条核对**期限**与金额」
 * 也被当成期限钉住；12 条上限被这类噪声占满，**真正的时效反而被挤出去**。
 * 这就是「宁缺毋滥」失守——钉错/钉垃圾的代价是把有用的挤掉（Chroma 的
 * distractor 效应：一个无关项就够掉分）。
 */
const DURATION_RE =
  /(?:\d+|[一二三四五六七八九十百千零两]+)\s*(?:个)?\s*(?:年|个月|月|日|天|周|星期|工作日)|起算|之日起|届满|之前|以内|内完成|到期/;

/** 金额类特征（窄）：必须带货币量词，避免把「第 3 条」「30%」误当金额。 */
const AMOUNT_RE = /(?:¥|￥|人民币)?\s*[0-9][0-9,，]*(?:\.[0-9]+)?\s*(?:万|亿)?\s*元/;

/** 硬约束特征（窄）：律师明确要求做/不做的祈使句。 */
const CONSTRAINT_RE = /(?:必须|不得|不要|不能|务必|严禁|一定要|切勿)/;

/** 法条引用特征：与 `collectDroppedCitationAnchors` 同一口径（复用它的召回能力）。 */
const CITATION_SENTENCE_RE = /《[^《》\n]{1,48}》|法释〔\d{4}〕\d+号|（\d{4}）[^）\n]{2,24}号/;

/** 按句切分：保留原句边界，避免把两件事粘成一条。 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。；！？!?;\n])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

function normalizeForDedupe(text: string): string {
  return text.replace(/[\s，。；：、（）()"'「」]/g, "");
}

/** 判断一句话属于哪一类（取**唯一**最强特征；判不出来就不钉）。 */
function classifySentence(sentence: string): FactPinKind | undefined {
  // 疑问句不是约束（「是否必须…？」是在问，不是在要求），也不是期限事实。
  const isQuestion = /[？?]\s*$/.test(sentence);
  if (!isQuestion && DEADLINE_TOPIC_RE.test(sentence) && DURATION_RE.test(sentence)) {
    return "deadline";
  }
  if (!isQuestion && CONSTRAINT_RE.test(sentence)) {
    return "constraint";
  }
  if (CITATION_SENTENCE_RE.test(sentence)) {
    return "citation";
  }
  if (AMOUNT_RE.test(sentence)) {
    return "amount";
  }
  return undefined;
}

function makeItem(kind: FactPinKind, text: string, caps: ContextPinsTuning): FactPinItem {
  const trimmed = text.trim().slice(0, caps.factItemCharCap);
  return {
    // id 只用于去重与展示，不做语义：kind + 归一化正文。
    id: `${kind}:${normalizeForDedupe(trimmed).slice(0, 48)}`,
    kind,
    text: trimmed,
    at: new Date().toISOString(),
  };
}

/**
 * 从**律师原话**里抽台账条目（纯函数）。
 *
 * 只应传律师自己的发言（`role === "user"` 且非合成消息）——助手写的数字与期限
 * 是模型产物，钉它等于把模型的话升格成律师的话。
 */
export function extractFactPinItems(text: string, tuning?: ContextPinsTuning): FactPinItem[] {
  const caps = capsOf(tuning);
  const out: FactPinItem[] = [];
  const seen = new Set<string>();
  for (const sentence of splitSentences(text)) {
    const kind = classifySentence(sentence);
    if (!kind) {
      continue;
    }
    const item = makeItem(kind, sentence, caps);
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * 合并台账：去重（双向子串也视为重复——长句包含短句时留长的那条，信息更全）、
 * 按优先级排序、双帽截断。**纯函数**，便于回归。
 */
export function mergeFactPinItems(
  existing: readonly FactPinItem[],
  incoming: readonly FactPinItem[],
  tuning?: ContextPinsTuning,
): FactPinItem[] {
  const caps = capsOf(tuning);
  const merged = [...existing];
  const has = (item: FactPinItem): boolean =>
    merged.some((m) => {
      if (m.id === item.id) {
        return true;
      }
      const a = normalizeForDedupe(m.text);
      const b = normalizeForDedupe(item.text);
      return a.includes(b) || b.includes(a);
    });

  for (const item of incoming) {
    if (has(item)) {
      continue;
    }
    merged.push(item);
  }

  const sorted = merged.toSorted((a, b) => {
    const byKind = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    return byKind !== 0 ? byKind : a.at.localeCompare(b.at);
  });

  const capped: FactPinItem[] = [];
  let used = 0;
  for (const item of sorted) {
    if (capped.length >= caps.factMaxItems) {
      break;
    }
    if (used + item.text.length > caps.factTotalCharCap) {
      continue;
    }
    capped.push(item);
    used += item.text.length;
  }
  return capped;
}

/** 从一条消息里抽台账（跳过合成消息）。 */
export function extractFactPinFromMessage(
  msg: AgentMessage,
  tuning?: ContextPinsTuning,
): FactPinItem[] {
  if (msg.role !== "user") {
    return [];
  }
  const text = (msg.content ?? "").trim();
  if (!text) {
    return [];
  }
  return extractFactPinItems(text, tuning);
}

/**
 * 补齐台账：用消息池里的**律师原话**（含法条引用锚点，因为它能从被丢弃的工具回包
 * 里把引用捞出来）补进 `session.factPin`。与 `taskPin` 同一条路径：
 * runTurn 首轮就抽、压缩时兜底。
 */
export function accumulateFactPin(
  session: {
    conversationHistory: AgentMessage[];
    factPin?: { items: FactPinItem[]; updatedAt: string };
  },
  pool: readonly AgentMessage[],
  tuning?: ContextPinsTuning,
): { added: number; total: number } {
  const caps = capsOf(tuning);
  if (!caps.factEnabled) {
    return { added: 0, total: session.factPin?.items.length ?? 0 };
  }
  const incoming: FactPinItem[] = [];
  for (const msg of pool) {
    incoming.push(...extractFactPinFromMessage(msg, caps));
  }
  // 法条引用单独召回：它可能只出现在被丢弃的**工具回包**里（模型是那时读到的）。
  const anchors = collectDroppedCitationAnchors(pool as AgentMessage[], caps.factCitationAnchorMax);
  for (const anchor of anchors) {
    incoming.push(makeItem("citation", anchor, caps));
  }
  if (incoming.length === 0) {
    return { added: 0, total: session.factPin?.items.length ?? 0 };
  }
  const before = session.factPin?.items.length ?? 0;
  const merged = mergeFactPinItems(session.factPin?.items ?? [], incoming, caps);
  session.factPin = { items: merged, updatedAt: new Date().toISOString() };
  return { added: Math.max(0, merged.length - before), total: merged.length };
}
