/**
 * 确定性模式抽取：审查表批量填充的离线执行器。
 *
 * 为什么需要它：交付前不让律师介入，也不该把「抽金额 / 抽日期 / 抽法院」这类
 * 有确定答案的活交给模型赌概率。模式能定的，引擎直接定；定不了的才交模型或弃答。
 *
 * 覆盖：金额、日期、期限天数、案号、法院、当事人/甲乙方、付款/交付期、管辖、
 * 违约金、送达地址。命中即给出文档内定位（行号）与出处，便于逐格可核验。
 *
 * **2026-10-21 语义修正（重要）**：正则是「找候选」，不是「下结论」。
 * 旧实现取首个命中即给 `confidence: high`，于是「甲方注册资本 100 万元」写在
 * 「本合同总价款 300 万元」之前时，「合同总价」会被填成 100 万，还带高置信度与
 * 真实行号——错了却看起来完全正确。现在：
 *   - 同一列命中多处 → 判为歧义，不猜，把候选交回模型/律师；
 *   - 只有一处，但该行没有与列名对应的角色词 → 标 `pattern_only`（降级，不算可核验）；
 *   - 只有一处且角色吻合 → `exact_quote`（可核验）。
 * 这样「抽错一个金额」不再以 high 置信度进入交付物。
 */

import type { ReviewExtractCandidate, ReviewExtractCellResult } from "./review-table-extract.js";

export type PatternId =
  | "amount"
  | "date"
  | "day_count"
  | "case_no"
  | "court"
  | "party"
  | "payment_term"
  | "delivery_term"
  | "jurisdiction"
  | "penalty"
  | "service_address";

export type PatternSpec = {
  id: PatternId;
  label: string;
  /** 匹配规则；按顺序取首个命中。 */
  regex: RegExp;
  /** 用于判断该列应该用哪个模式（列 key / label / prompt 任一命中）。 */
  columnHints: RegExp;
};

const CN_NUM = "零一二三四五六七八九十百千万亿两";

export const REVIEW_PATTERNS: PatternSpec[] = [
  {
    id: "case_no",
    label: "案号",
    regex: /[（(]\s*\d{4}\s*[)）][^\s，。；]{0,12}?号/g,
    columnHints: /案号|案件编号|case.?no/i,
  },
  {
    id: "court",
    label: "法院",
    regex: /[\u4e00-\u9fff]{2,20}?(?:人民法院|中级人民法院|高级人民法院|专门法院)/g,
    columnHints: /法院|审理法院|管辖法院|court/i,
  },
  {
    id: "amount",
    label: "金额",
    regex: new RegExp(
      `(?:人民币|RMB|￥|¥)?\\s*\\d[\\d,，]*(?:\\.\\d+)?\\s*(?:万元|亿元|万|元|美元|港元)|[${CN_NUM}]+(?:万|亿)?元`,
      "g",
    ),
    columnHints: /金额|价款|赔偿|索赔|标的|费用|数额|amount|price/i,
  },
  {
    id: "date",
    label: "日期",
    regex: /\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?/g,
    columnHints: /日期|签订|签署|起算|到期|届满|date/i,
  },
  {
    id: "day_count",
    label: "天数",
    regex: new RegExp(`(?:\\d+|[${CN_NUM}]{1,4})\\s*(?:个)?(?:工作日|自然日|日|天)内?`, "g"),
    columnHints: /期限|天数|日内|期日|term|duration/i,
  },
  {
    id: "payment_term",
    label: "付款约定",
    regex: new RegExp(`[^。；\\n]{0,30}(?:付款|支付|结清|付清)[^。；\\n]{0,60}`),
    columnHints: /付款|支付|价款支付|payment/i,
  },
  {
    id: "delivery_term",
    label: "交付约定",
    regex: new RegExp(`[^。；\\n]{0,30}(?:交付|交货|验收|完成服务)[^。；\\n]{0,60}`),
    columnHints: /交付|交货|验收|delivery/i,
  },
  {
    id: "jurisdiction",
    label: "争议解决",
    regex: new RegExp(`[^。；\\n]{0,30}(?:管辖|仲裁|争议解决|诉讼)[^。；\\n]{0,60}`),
    columnHints: /管辖|争议解决|仲裁|jurisdiction|dispute/i,
  },
  {
    id: "penalty",
    label: "违约责任",
    regex: new RegExp(`[^。；\\n]{0,30}(?:违约金|违约责任|损失赔偿)[^。；\\n]{0,60}`),
    columnHints: /违约金|违约责任|责任上限|penalty|liabilit/i,
  },
  {
    id: "service_address",
    label: "送达地址",
    regex: new RegExp(`[^。；\\n]{0,20}(?:送达地址|通讯地址|联系地址)[^。；\\n]{0,60}`),
    columnHints: /送达|地址|通讯|service.?address/i,
  },
  {
    id: "party",
    label: "当事人",
    regex: new RegExp(`[^。；\\n]{0,12}(?:甲方|乙方|丙方|委托人|受托人)[：:]?[^。；\\n]{0,40}`),
    columnHints: /当事人|主体|甲方|乙方|party|委托人/i,
  },
];

/** 列 → 模式：列 key/label/prompt 命中即用（可多模式，按 catalog 顺序）。 */
export function patternsForColumn(column: {
  key: string;
  label: string;
  prompt?: string;
}): PatternSpec[] {
  const hay = `${column.key} ${column.label} ${column.prompt ?? ""}`;
  return REVIEW_PATTERNS.filter((p) => p.columnHints.test(hay));
}

/** 一格内的一个候选：值 + 行号 + 该行原文，供模型/律师判角色。 */
export type PatternCandidate = {
  patternId: PatternId;
  patternLabel: string;
  value: string;
  /** `line=12`，与 `buildCellSource` 拼成 `path#line=12`。 */
  locator: string;
  /** 命中行的原文片段（已裁剪），用来判断这个值是不是该列要的那个。 */
  lineText: string;
  /** 命中行（含下一行，兼容换行折断）是否含列名对应的角色词。 */
  roleSupported: boolean;
};

/**
 * 通用列名用词：不含具体字段角色，不能证明「这处命中就是这一列要的值」。
 * 例：「金额」只说明要一个数，不区分注册资本 / 合同价款 / 违约金。
 */
const GENERIC_BIGRAMS: ReadonlySet<string> = new Set([
  "金额",
  "数额",
  "额度",
  "价款",
  "费用",
  "日期",
  "时间",
  "期间",
  "名称",
  "内容",
  "条款",
  "情况",
  "说明",
  "约定",
  "备注",
  "风险",
  "等级",
  "来源",
  "文件",
  "事项",
  "编号",
  "标准",
  "具体",
  "相关",
  "主要",
  "本次",
  "是否",
]);

function cjkRuns(text: string): string[] {
  return text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
}

/**
 * 列名的「角色二元组」：用于判断命中行是否真的在讲这一列。
 * 只取非通用二元组，避免「金额」「日期」这种词把所有命中都洗成可核验。
 */
export function columnRoleBigrams(column: {
  key: string;
  label: string;
  prompt?: string;
}): string[] {
  const hay = `${column.label} ${column.prompt ?? ""}`;
  const out = new Set<string>();
  for (const run of cjkRuns(hay)) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const bigram = run.slice(i, i + 2);
      if (GENERIC_BIGRAMS.has(bigram)) {
        continue;
      }
      out.add(bigram);
    }
  }
  return [...out];
}

function lineSupportsRole(
  lines: readonly string[],
  index: number,
  column: { key: string; label: string; prompt?: string } | undefined,
  value: string,
  matchIndex: number,
): boolean {
  if (!column) {
    return false;
  }
  // A field label must precede this value in the same clause (or on a label-only line).
  // Generic shared words such as 合同 cannot turn registered capital into contract price.
  const label = column.label.replace(/^(?:本|该)(?=合同)/, "").trim();
  if (!label || GENERIC_BIGRAMS.has(label)) {
    return false;
  }
  const line = lines[index] ?? "";
  const before = line.slice(0, matchIndex);
  const clause = before.split(/[。；;，,]/).at(-1) ?? "";
  const previous = !before.trim() ? (lines[index - 1] ?? "").trim() : "";
  const direct = clause.includes(label) && !/另议|另行|未约定|不含|不包括/.test(clause);
  const labelOnly = previous.replace(/[：:\s]/g, "") === label.replace(/\s/g, "");
  // Sentence-valued patterns already contain their own role label.
  return direct || labelOnly || value.includes(label);
}

function clipLine(text: string, start = 0, length = 0, max = 240): string {
  // Keep an exact source substring containing the match, never a synthetic ellipsis.
  const from = Math.max(0, start - Math.floor((max - Math.min(length, max)) / 2));
  return text.slice(from, Math.max(from + max, start + length)).trim();
}

/**
 * 找出某一模式下**全部**候选（有上限，避免长附件刷屏）。
 * 与旧 `matchPattern` 的区别：不再只看第一个命中。
 */
export function findCandidates(
  text: string,
  spec: PatternSpec,
  opts?: {
    column?: { key: string; label: string; prompt?: string };
    maxCandidates?: number;
  },
): PatternCandidate[] {
  const lines = text.split(/\n/);
  const max = Math.max(1, Math.min(opts?.maxCandidates ?? 8, 32));
  const out: PatternCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length && out.length < max; i += 1) {
    const line = lines[i] ?? "";
    const re = new RegExp(
      spec.regex.source,
      spec.regex.flags.includes("g") ? spec.regex.flags : `${spec.regex.flags}g`,
    );
    for (const m of line.matchAll(re)) {
      const value = (m[0] ?? "").trim();
      if (!value) {
        continue;
      }
      const clipped = value.slice(0, 200);
      const locator = `line=${i + 1}`;
      const key = `${clipped}\u0000${locator}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({
        patternId: spec.id,
        patternLabel: spec.label,
        value: clipped,
        locator,
        lineText: clipLine(line, m.index ?? 0, m[0].length),
        roleSupported: lineSupportsRole(lines, i, opts?.column, value, m.index ?? 0),
      });
      if (out.length >= max) {
        break;
      }
    }
  }
  return out;
}

/**
 * 兼容旧调用：取首个命中。
 * 新代码请用 `findCandidates` —— 首个命中不等于正确答案。
 */
export function matchPattern(
  text: string,
  spec: PatternSpec,
  column?: { key: string; label: string; prompt?: string },
): { value: string; locator: string } | undefined {
  const first = findCandidates(text, spec, { ...(column ? { column } : {}), maxCandidates: 1 })[0];
  return first ? { value: first.value, locator: first.locator } : undefined;
}

/**
 * 确定性抽取器：给审查表批量填充用。
 *
 * 语义（2026-10-21 修正）：
 * - 唯一候选且命中行含列名角色词 → 可核验（`exact_quote`，非 OCR 时 high）。
 * - 唯一候选但角色词不吻合 → 降级 `pattern_only`（medium），标为待核对，不算可核验。
 * - 多个候选 → **判为歧义**，不猜：返回候选清单，格子先弃答，等模型/律师定。
 * - 没有候选 → 弃答并说明原因，不编造。
 */
export function createPatternExtractor(): (input: {
  doc: { relPath: string };
  column: { key: string; label: string; prompt?: string };
  text: string;
  fromOcr: boolean;
}) => Promise<ReviewExtractCellResult> {
  return async ({ column, text, fromOcr }) => {
    const specs = patternsForColumn(column);
    if (specs.length === 0) {
      return {
        ok: false,
        reason: `该列（${column.label}）无确定性模式，需模型判断或人工`,
      };
    }

    const allCandidates: PatternCandidate[] = [];
    const seen = new Set<string>();
    const pushUnique = (candidate: PatternCandidate): void => {
      const key = `${candidate.value}\u0000${candidate.locator}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      allCandidates.push(candidate);
    };

    for (const spec of specs) {
      const found = findCandidates(text, spec, { column });
      for (const candidate of found) {
        pushUnique(candidate);
      }
      // The first matching pattern determines the field shape, not the semantic winner.
      // All of its distinct candidates go back to the parent for explicit selection.
      if (found.length > 0) {
        break;
      }
    }

    if (allCandidates.length === 0) {
      return { ok: false, reason: `未检出${specs.map((s) => s.label).join("/")}` };
    }

    // 没有角色吻合的候选：值可能对、也可能不是这一列要的那个，降级并要求核对。
    const distinct = [...new Set(allCandidates.map((c) => c.value))];
    if (distinct.length > 1) {
      return {
        ok: false,
        reason: `「${column.label}」有 ${distinct.length} 处可能的值，无法确定取哪一个`,
        ambiguous: true,
        candidates: allCandidates.slice(0, 5).map(toCandidateView),
      };
    }
    const only = allCandidates[0];
    return {
      ok: true,
      value: only.value,
      locator: only.locator,
      confidence: only.roleSupported ? (fromOcr ? "low" : "high") : "medium",
      basis: only.roleSupported ? "exact_quote" : "pattern_only",
      note: only.roleSupported
        ? `按「${only.patternLabel}」唯一原句抽取`
        : `按「${only.patternLabel}」模式抽取；原文未出现与列名对应的字样，请核对是否同一字段`,
      candidates: allCandidates.slice(0, 5).map(toCandidateView),
    };
  };
}

function toCandidateView(candidate: PatternCandidate): ReviewExtractCandidate {
  return {
    value: candidate.value,
    locator: candidate.locator,
    lineText: candidate.lineText,
    patternLabel: candidate.patternLabel,
  };
}
