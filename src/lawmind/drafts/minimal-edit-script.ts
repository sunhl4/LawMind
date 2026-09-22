/**
 * 最短改动（minimal edits）—— LawMind 所有落槌修改的**硬不变量**。
 *
 * 为什么要有这个模块（而不是继续用「find 太长就拒」）：
 * 带修订的 Word 是多人协作面。若一句话里只改了几个字，却把整句删掉再整句新增，
 * 同事看到的是「这句话被重写了」——没法逐处接受、也会把手上的修订轨冲掉。
 * 正常人的改法就是**只把那几个字标成删除/新增，中间没动的字留在修订轨之外**。
 *
 * 所以本模块不做「审查」，只做**重算**：给定任意一对待改文本 (before, after)，
 * 求出使保留文字最大化的最小改动集合。判定口径是可证明的、与文本长度无关的：
 *
 *   **任一处改动里，不得含有长度 ≥ MINIMAL_EDIT_MAX_UNCHANGED_RUN 的未改文字。**
 *
 * 实现方式保证这条成立：反复在 (before, after) 里找**最长公共片段**（锚点），
 * 锚点即「没动的字」，把它从两侧同时摘掉后对左右两段递归。递归到某一段两侧
 * 不再有任何长度 ≥ MINIMAL_ANCHOR_CHARS 的公共片段时，那一段就是**真改动**，
 * 整段作为一处最短改动输出。
 *
 * 由此得到两个可证明的性质（MINIMAL_ANCHOR_CHARS ≤ MINIMAL_EDIT_MAX_UNCHANGED_RUN）：
 *  1. 构造出的每一处改动内部，都不含任何 ≥ MINIMAL_ANCHOR_CHARS 的未改片段
 *     → 自动满足上面那条硬不变量（无需事后补救）。
 *  2. 把结果按位置回放到 before 上，得到的必然**逐字等于** after（锚点是两侧共有的
 *     原文，摘掉它不改变语义）→ 不会凭空发明改动，也不会丢字。
 *
 * 长度不再是罪名：真把一整句换成另一句（一个共同片段都没有）时，那本来就是一处
 * 合法的最短改动，不该被「find 超过 N 字」拦下。
 */

import { commonAffixLength } from "./surgical-span-gate.js";

/**
 * 认为「这段文字没动」的最短长度。
 * 低于它的公共片段视为巧合（「的」「甲方」这类），不作为锚点，否则会把一处改动切碎。
 */
export const MINIMAL_ANCHOR_CHARS = 4;

/**
 * 硬不变量门槛：一处改动内允许出现的未改文字上限。
 * 必须 ≥ MINIMAL_ANCHOR_CHARS，构造结果才不会自撞门槛（见文件头注释）。
 */
export const MINIMAL_EDIT_MAX_UNCHANGED_RUN = 6;

/** 锚点搜索的长度上限：更长的保留段只需切出其中一段即可完成拆分。 */
const ANCHOR_MAX_CHARS = 120;
/** 同一锚点在两侧的候选位置上限（取对齐最好的一对，避免重复短语错位）。 */
const ANCHOR_MAX_OCCURRENCES = 16;
/** 递归改成显式栈，避免长文本深递归。 */
const MAX_SPANS = 400;

export type MinimalChangeSpan = {
  /** 改动起点（相对 before 的字符下标）。 */
  spanStart: number;
  /** 改动终点（相对 before，开区间）。 */
  spanEnd: number;
  /** 被改动的原文（可能为空 = 纯插入）。 */
  before: string;
  /** 改动后的文字（可能为空 = 纯删除）。 */
  after: string;
};

/**
 * 在 a 中找长度 L 的片段集合，用于判断 (b, a) 是否存在该长度的公共片段。
 * 返回第一个命中的 L 长度片段（b 侧位置 + a 侧位置），没有则 null。
 */
function findAnchorOfLength(
  b: string,
  a: string,
  length: number,
): { bIndex: number; aIndex: number } | null {
  if (length <= 0 || b.length < length || a.length < length) {
    return null;
  }
  const positions = new Map<string, number[]>();
  for (let i = 0; i + length <= a.length; i += 1) {
    const key = a.slice(i, i + length);
    const list = positions.get(key);
    if (list) {
      if (list.length < ANCHOR_MAX_OCCURRENCES) {
        list.push(i);
      }
    } else {
      positions.set(key, [i]);
    }
  }
  for (let i = 0; i + length <= b.length; i += 1) {
    const hits = positions.get(b.slice(i, i + length));
    if (!hits || hits.length === 0) {
      continue;
    }
    // 多个候选时取「相对位置最接近」的一对：重复短语（如两处「甲方」）不会错位。
    let best = hits[0];
    for (const j of hits) {
      if (Math.abs(j - i) < Math.abs(best - i)) {
        best = j;
      }
    }
    return { bIndex: i, aIndex: best };
  }
  return null;
}

/**
 * 最长公共片段（锚点）。二分长度 + 子串索引：对合同段落这种量级足够快，
 * 且命中长度只影响拆分粒度，不影响正确性（见文件头注释）。
 */
function findLongestCommonAnchor(
  b: string,
  a: string,
): { bIndex: number; aIndex: number; length: number } | null {
  const maxLen = Math.min(b.length, a.length, ANCHOR_MAX_CHARS);
  if (maxLen < MINIMAL_ANCHOR_CHARS) {
    return null;
  }
  let lo = MINIMAL_ANCHOR_CHARS;
  let hi = maxLen;
  let best: { bIndex: number; aIndex: number; length: number } | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const hit = findAnchorOfLength(b, a, mid);
    if (hit) {
      best = { ...hit, length: mid };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * 把任意 (before, after) 重算成一组**最长保留**的最短改动。
 * before === after 时返回空数组（无事可做）。
 */
export function computeMinimalEditSpans(before: string, after: string): MinimalChangeSpan[] {
  if (before === after) {
    return [];
  }
  const out: MinimalChangeSpan[] = [];
  // 显式栈：每一层是「待处理的 (b, a) 与它在 before 里的起点」。
  const stack: Array<{ b: string; a: string; at: number }> = [{ b: before, a: after, at: 0 }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      break;
    }
    const { prefix, suffix } = commonAffixLength(frame.b, frame.a);
    const b = frame.b.slice(prefix, frame.b.length - suffix);
    const a = frame.a.slice(prefix, frame.a.length - suffix);
    const at = frame.at + prefix;
    if (b === "" && a === "") {
      continue;
    }
    if (out.length >= MAX_SPANS && (b || a)) {
      // 极端碎片化保护：合并为一段（仍然正确，只是保留文字较少）。
      out.push({ spanStart: at, spanEnd: at + b.length, before: b, after: a });
      continue;
    }
    const anchor = b === "" || a === "" ? null : findLongestCommonAnchor(b, a);
    if (!anchor) {
      out.push({ spanStart: at, spanEnd: at + b.length, before: b, after: a });
      continue;
    }
    const leftB = b.slice(0, anchor.bIndex);
    const leftA = a.slice(0, anchor.aIndex);
    const rightB = b.slice(anchor.bIndex + anchor.length);
    const rightA = a.slice(anchor.aIndex + anchor.length);
    // 先压右再压左：弹出时左先处理，输出天然按位置升序。
    if (rightB !== "" || rightA !== "") {
      stack.push({ b: rightB, a: rightA, at: at + anchor.bIndex + anchor.length });
    }
    if (leftB !== "" || leftA !== "") {
      stack.push({ b: leftB, a: leftA, at });
    }
  }
  return out.toSorted((x, y) => x.spanStart - y.spanStart);
}

/** 一处改动内部最长的未改片段长度；无未改文字时为 0。 */
export function longestUnchangedRunInside(span: { before: string; after: string }): number {
  const anchor = findLongestCommonAnchor(span.before ?? "", span.after ?? "");
  return anchor ? anchor.length : 0;
}

/** 纯插入时取插入点之后多少字作为锚点（Word 修订轨与 officecli lookbehind 同一思路）。 */
export const INSERT_ANCHOR_CHARS = 6;

/**
 * 把**纯插入**的最短改动表达成 find/replace。
 *
 * 有些落笔面只会做 find/replace（跨文书一致改、Word 插件）。若把这处改动写成
 * 「find 为空」，就会被误判成「本档没有该锚点」而漏改。所以改成：
 * find = 插入点之后的原文锚点；replace = 插入内容 + 该锚点 —— 一个字都不删。
 *
 * 文末插入没有右侧原文可锚：返回 null，由调用方如实计入「无法就地落改」。
 */
export function expressInsertAsAnchorReplace(params: {
  /** 插入点（相对 after 文本的字符下标）。 */
  insertAt: number;
  inserted: string;
  /** 改动后的完整文本（用于取锚点）。 */
  afterText: string;
  anchorChars?: number;
}): { find: string; replace: string } | null {
  const { insertAt, inserted, afterText } = params;
  if (!inserted) {
    return null;
  }
  const width = params.anchorChars ?? INSERT_ANCHOR_CHARS;
  const anchor = afterText.slice(insertAt, insertAt + width);
  if (!anchor) {
    return null;
  }
  return { find: anchor, replace: inserted + anchor };
}

/** 纯插入 span 在 after 文本里的插入点。 */
export function insertPointInAfterText(span: {
  spanStart: number;
  before: string;
  after: string;
}): number {
  return span.spanStart + span.after.length;
}

export type MinimalEditViolation = {
  spanStart: number;
  spanEnd: number;
  unchangedRun: number;
  reason: string;
};

/**
 * 独立复核（不信任调用方给的 span）：重算一遍，逐处核对
 * ① 内部未改片段是否超门槛 ② span 是否与 before/after 自洽 ③ 是否互不重叠。
 */
export function auditMinimalEditSpans(params: {
  before: string;
  after: string;
  spans: Array<{ spanStart?: number; spanEnd?: number; before: string; after: string }>;
}): { ok: boolean; violations: MinimalEditViolation[]; canonical: MinimalChangeSpan[] } {
  const before = params.before ?? "";
  const after = params.after ?? "";
  const canonical = computeMinimalEditSpans(before, after);
  const violations: MinimalEditViolation[] = [];
  let cursor = -1;
  for (const span of params.spans ?? []) {
    const start = typeof span.spanStart === "number" ? span.spanStart : -1;
    const end = typeof span.spanEnd === "number" ? span.spanEnd : -1;
    if (start < 0 || end < start || end > before.length) {
      violations.push({
        spanStart: start,
        spanEnd: end,
        unchangedRun: before.length,
        reason: "span 与原文范围不自洽（无法按位置核对）",
      });
      continue;
    }
    if (start < cursor) {
      violations.push({
        spanStart: start,
        spanEnd: end,
        unchangedRun: 0,
        reason: "span 与前一处在位置上重叠",
      });
    }
    cursor = Math.max(cursor, end);
    if (before.slice(start, end) !== (span.before ?? "")) {
      violations.push({
        spanStart: start,
        spanEnd: end,
        unchangedRun: 0,
        reason: "span 的 before 与原文该区间不一致",
      });
      continue;
    }
    const unchangedRun = longestUnchangedRunInside(span);
    if (unchangedRun >= MINIMAL_EDIT_MAX_UNCHANGED_RUN) {
      violations.push({
        spanStart: start,
        spanEnd: end,
        unchangedRun,
        reason: `这一处改动里夹了 ${unchangedRun} 个没动的字，应拆成多处`,
      });
    }
  }
  return { ok: violations.length === 0, violations, canonical };
}

/** 最短改动的单行规则（进提示词；尽量短，工具描述有 token 预算）。 */
export const MINIMAL_EDIT_RULE_LINE =
  "最短改动（硬约束）：只把真正变动的字标成删除/新增，中间没动的字不得包进改动里；一句话里改几个字就只改那几个字。引擎会按此重算，不接受整句删写。";

/** 最短改动的完整口径（技能/文档用，可展开解释）。 */
export const MINIMAL_EDIT_RULE_TEXT = [
  MINIMAL_EDIT_RULE_LINE,
  "",
  "为什么：带修订的 Word 是多人协作面。整句删+整句增会让同事无法逐处接受，也会覆盖别人手里的修订轨。",
  "引擎怎么保证：每处改动都由 (原文, 改后) 重算——先摘掉两侧共有的未改片段，只把剩下的真改动标出来；一句里有几处改动就出几处，互不重叠。",
  `判定门槛：一处改动内若夹了 ≥${MINIMAL_EDIT_MAX_UNCHANGED_RUN} 个连续未改文字，即视为未最小化，会被自动拆分。`,
  "长度不是罪名：整句确实换成另一句（没有任何共有片段）时，那本身就是一处合法改动。",
].join("\n");
