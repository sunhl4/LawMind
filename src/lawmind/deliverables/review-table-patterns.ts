/**
 * 确定性模式抽取：审查表批量填充的离线执行器。
 *
 * 为什么需要它：交付前不让律师介入，也不该把「抽金额 / 抽日期 / 抽法院」这类
 * 有确定答案的活交给模型赌概率。模式能定的，引擎直接定；定不了的才交模型或弃答。
 *
 * 覆盖：金额、日期、期限天数、案号、法院、当事人/甲乙方、付款/交付期、管辖、
 * 违约金、送达地址。命中即给出文档内定位（行号）与出处，便于逐格可核验。
 */

import type { ReviewExtractCellResult } from "./review-table-extract.js";

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

/** 取首个命中；带行号定位。 */
export function matchPattern(
  text: string,
  spec: PatternSpec,
): { value: string; locator: string } | undefined {
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const re = new RegExp(
      spec.regex.source,
      spec.regex.flags.includes("g") ? spec.regex.flags : `${spec.regex.flags}g`,
    );
    const m = re.exec(line);
    if (m && m[0].trim()) {
      return { value: m[0].trim().slice(0, 200), locator: `line=${i + 1}` };
    }
  }
  return undefined;
}

/**
 * 确定性抽取器：给审查表批量填充用。
 * - 列能映射到模式且正文命中 → 有出处、置信 high/medium。
 * - 列有模式但正文未命中 → 弃答（不猜）。
 * - 列没有可用模式 → 弃答并说明该列需模型判断（由上层决定是否换模型抽取器）。
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
    for (const spec of specs) {
      const hit = matchPattern(text, spec);
      if (hit) {
        return {
          ok: true,
          value: hit.value,
          locator: hit.locator,
          confidence: fromOcr ? "low" : "high",
          note: `按「${spec.label}」模式抽取`,
        };
      }
    }
    return { ok: false, reason: `未检出${specs.map((s) => s.label).join("/")}` };
  };
}
