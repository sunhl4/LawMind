import {
  CHINESE_INTEGER_PATTERN,
  CHINESE_NUMERAL_PATTERN,
  parseChineseDecimal,
  parseChineseInteger,
} from "./chinese-numeral.js";
import { CONSTRUCTION_LINT_RULES } from "./families/construction.js";
import { EMPLOYMENT_LINT_RULES } from "./families/employment.js";
import { EQUITY_LINT_RULES } from "./families/equity.js";
import { LEASE_LINT_RULES } from "./families/lease.js";
import { LOAN_LINT_RULES } from "./families/loan.js";
import { SALE_LINT_RULES } from "./families/sale.js";
import { lintFinding as finding } from "./finding.js";
import { GENERAL_EXTRA_LINT_RULES } from "./general.js";
import { DEPOSIT_CAP } from "./statute-params.js";
import type { LegalLintFinding, LegalLintRule } from "./types.js";

const amountCaseRule: LegalLintRule = {
  id: "consistency.amount_case",
  family: "consistency",
  run(text) {
    const findings: LegalLintFinding[] = [];
    const money = [...text.matchAll(/([0-9][0-9,]{2,})\s*元/g)];
    const hasUpper = /[壹贰叁肆伍陆柒捌玖拾佰仟万亿]/.test(text);
    if (money.length >= 2 && !hasUpper) {
      findings.push(
        finding(amountCaseRule, "warning", "出现多处阿拉伯数字金额，未见大写金额对照。", {
          fixable: false,
        }),
      );
    }
    return findings;
  },
};

const definedTermsRule: LegalLintRule = {
  id: "consistency.defined_terms",
  family: "consistency",
  run(text) {
    const findings: LegalLintFinding[] = [];
    const definedHits = [
      ...text.matchAll(/[「“"]([^」”"]{1,20})[」”"]\s*[（(]以下简称[^）)]{0,20}[）)]/g),
    ];
    const unused: string[] = [];
    for (const m of definedHits) {
      const term = (m[1] ?? "").trim();
      if (!term) {
        continue;
      }
      const rest = text.replace(m[0], "");
      if (!rest.includes(term)) {
        unused.push(term);
      }
    }
    if (unused.length > 0) {
      findings.push(
        finding(
          definedTermsRule,
          "info",
          `定义了「${unused.slice(0, 3).join("、")}」但正文未见再用。`,
          {
            anchor: unused[0],
          },
        ),
      );
    } else if (
      definedHits.length === 0 &&
      !/定义条款|释义/.test(text) &&
      /第\s*1\s*条/.test(text)
    ) {
      findings.push(
        finding(definedTermsRule, "info", "未见定义条款或「以下简称」表述，专有名词可能未统一。"),
      );
    }
    return findings;
  },
};

/**
 * 条号统一识别：阿拉伯数字与中文数字（第五条、第十二条）都认，
 * 解析走 chinese-numeral 保守口径——失败按未识别处理，不误报。
 */
const ARTICLE_NO_RE = new RegExp(`第\\s*(\\d+|${CHINESE_INTEGER_PATTERN})\\s*条`, "g");

/**
 * 序号连续性检查专用：排除「民法典第586条」「本条例第40条」等法条引用语境，
 * 否则合同第 N 条之后出现的大条号会被误判为编号断裂。
 */
const ARTICLE_NO_INTERNAL_RE = new RegExp(
  `(?<![法典释例定])第\\s*(\\d+|${CHINESE_INTEGER_PATTERN})\\s*条`,
  "g",
);

/**
 * 引用语境引导词：只有「引导词 + 第X条」才算引用性提及，其余「第X条」一律按
 * 定义性条款头处理——宁可少报，不可把条款头误当引用导致悬空误报。
 */
const CROSS_REF_LEADERS = [
  "根据",
  "依据",
  "依照",
  "按照",
  "见",
  "符合",
  "违反",
  "适用",
  "参照",
  "援引",
];

const crossRefRule: LegalLintRule = {
  id: "consistency.cross_ref",
  family: "consistency",
  run(text) {
    const findings: LegalLintFinding[] = [];
    const defined = new Set<number>();
    const referenced = new Set<number>();
    for (const m of text.matchAll(ARTICLE_NO_RE)) {
      const n = parseChineseInteger(m[1] ?? "");
      if (!Number.isFinite(n)) {
        continue;
      }
      const idx = m.index ?? 0;
      const before = text.slice(Math.max(0, idx - 4), idx);
      if (CROSS_REF_LEADERS.some((w) => before.endsWith(w))) {
        referenced.add(n);
      } else {
        defined.add(n);
      }
    }
    const dangling = [...referenced].filter((n) => !defined.has(n)).toSorted((a, b) => a - b);
    if (dangling.length > 0) {
      findings.push(
        finding(
          crossRefRule,
          "warning",
          `交叉引用可能悬空：第 ${dangling.slice(0, 4).join("、")} 条未见正文。`,
          {
            anchor: `第${dangling[0]}条`,
          },
        ),
      );
    }
    return findings;
  },
};

const articleNumberingRule: LegalLintRule = {
  id: "consistency.article_numbering",
  family: "consistency",
  run(text) {
    const nums = [...text.matchAll(ARTICLE_NO_INTERNAL_RE)]
      .map((m) => parseChineseInteger(m[1] ?? ""))
      .filter((n) => Number.isFinite(n));
    const unique = [...new Set(nums)].toSorted((a, b) => a - b);
    if (unique.length >= 4) {
      for (let i = 1; i < unique.length; i += 1) {
        const prev = unique[i - 1] ?? 0;
        const cur = unique[i] ?? 0;
        if (cur - prev > 1) {
          return [
            finding(
              articleNumberingRule,
              "info",
              `条款编号不连续：第 ${prev} 条之后直接到第 ${cur} 条。`,
            ),
          ];
        }
      }
    }
    return [];
  },
};

const dateOrderRule: LegalLintRule = {
  id: "consistency.date_order",
  family: "consistency",
  run(text) {
    const dates = [
      ...text.matchAll(/((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g),
    ].map((m) => {
      const y = Number.parseInt(m[1] ?? "", 10);
      const mo = Number.parseInt(m[2] ?? "", 10);
      const d = Number.parseInt(m[3] ?? "", 10);
      return { y, mo, d, t: Date.UTC(y, mo - 1, d), raw: m[0] };
    });
    if (dates.length >= 2) {
      const first = dates[0];
      const last = dates[dates.length - 1];
      if (first && last && last.t < first.t && /生效|签署|起始/.test(text)) {
        return [
          finding(
            dateOrderRule,
            "warning",
            `文中日期顺序可疑：${first.raw} 晚于其后出现的 ${last.raw}。`,
          ),
        ];
      }
    }
    return [];
  },
};

export type DepositPercentHit = {
  /** 命中的原文片段（含「定金」前缀）。 */
  span: string;
  /** 百分比数值，如 25.5。 */
  pct: number;
};

/**
 * 提取定金比例表述：阿拉伯数字（含小数、三位以上）与「百分之X」中文表述都识别。
 * 「定额定金」等无百分比场景不产出命中，保持既有行为。
 */
export function findDepositPercents(text: string): DepositPercentHit[] {
  if (!/定金/.test(text)) {
    return [];
  }
  const hits: Array<DepositPercentHit & { index: number }> = [];
  for (const m of text.matchAll(/定金[^。]{0,24}?(\d+(?:\.\d+)?)\s*%/g)) {
    const pct = Number.parseFloat(m[1] ?? "");
    if (Number.isFinite(pct)) {
      hits.push({ span: m[0], pct, index: m.index ?? 0 });
    }
  }
  const cnRe = new RegExp(`定金[^。]{0,24}?百分之(${CHINESE_NUMERAL_PATTERN})`, "g");
  for (const m of text.matchAll(cnRe)) {
    const pct = parseChineseDecimal(m[1] ?? "");
    if (Number.isFinite(pct)) {
      hits.push({ span: m[0], pct, index: m.index ?? 0 });
    }
  }
  // 同一处表述（如「百分之三十（30%）」被两种形态同时命中）只报一次。
  hits.sort((a, b) => a.index - b.index);
  const deduped: Array<DepositPercentHit & { index: number }> = [];
  for (const h of hits) {
    const prev = deduped[deduped.length - 1];
    if (prev && h.pct === prev.pct && h.index < prev.index + prev.span.length) {
      continue;
    }
    deduped.push(h);
  }
  return deduped.map(({ span, pct }) => ({ span, pct }));
}

const depositCapRule: LegalLintRule = {
  id: "statutory.deposit_cap",
  family: "statutory_cap",
  run(text) {
    const findings: LegalLintFinding[] = [];
    for (const hit of findDepositPercents(text)) {
      if (hit.pct / 100 > DEPOSIT_CAP.value) {
        findings.push(
          finding(
            depositCapRule,
            "blocker",
            `定金比例 ${hit.pct}% 超过法定上限 ${DEPOSIT_CAP.value * 100}%。`,
            {
              statuteRef: DEPOSIT_CAP.source,
              fixable: true,
              anchor: hit.span,
            },
          ),
        );
      }
    }
    return findings;
  },
};

/**
 * 或裁或诉语序变体：要求同时出现仲裁与诉讼/起诉，且存在明确的选择/并列表述。
 * 单一仲裁约定（如「提交XX仲裁委员会仲裁」）不含诉讼与选择词，不会命中。
 */
const OR_ARBITRATE_DISJUNCTIVE =
  /或\s*仲裁\s*或|或\s*(?:诉讼|起诉)\s*或|既可以[^。]{0,16}仲裁[^。]{0,16}也可以|选择[^。]{0,12}仲裁[^。]{0,6}或|仲裁[^。]{0,8}或(?:者)?[^。]{0,8}(?:诉讼|起诉)|(?:诉讼|起诉)[^。]{0,8}或(?:者)?[^。]{0,8}仲裁/;

const orArbitrateOrSueRule: LegalLintRule = {
  id: "form.or_arbitrate_or_sue",
  family: "form",
  run(text) {
    const both =
      /仲裁/.test(text) && /起诉|诉讼|人民法院/.test(text) && OR_ARBITRATE_DISJUNCTIVE.test(text);
    if (both) {
      return [
        // 条文号待执业法律顾问复核（或裁或诉协议无效之依据）
        finding(
          orArbitrateOrSueRule,
          "blocker",
          "争议解决同时指向仲裁与诉讼（或裁或诉），仲裁协议可能无效。",
          {
            statuteRef: "仲裁法司法解释第7条",
            fixable: true,
          },
        ),
      ];
    }
    return [];
  },
};

const jurisdictionFormRule: LegalLintRule = {
  id: "form.jurisdiction",
  family: "form",
  run(text) {
    if (/管辖|争议解决/.test(text) && !/仲裁|人民法院|法院/.test(text)) {
      return [
        finding(
          jurisdictionFormRule,
          "warning",
          "出现管辖/争议解决用语，但未见仲裁机构或管辖法院。",
        ),
      ];
    }
    return [];
  },
};

const signatureBlockRule: LegalLintRule = {
  id: "form.signature_block",
  family: "form",
  run(text) {
    if (text.length < 400) {
      return [];
    }
    if (/协议|合同/.test(text) && !/签章|签署|法定代表人|盖章/.test(text)) {
      return [finding(signatureBlockRule, "warning", "合同/协议未见签章或签署栏。")];
    }
    return [];
  },
};

const placeholderRule: LegalLintRule = {
  id: "placeholder.open",
  family: "placeholder",
  run(text) {
    const hits = [...text.matchAll(/【待补充】|\[待补充\]|TODO|XXX{2,}/gi)];
    if (hits.length > 0) {
      return [
        finding(placeholderRule, "warning", `仍有 ${hits.length} 处待补占位，不宜直接外发。`, {
          anchor: hits[0]?.[0],
        }),
      ];
    }
    return [];
  },
};

const CORE_LINT_RULES: LegalLintRule[] = [
  amountCaseRule,
  definedTermsRule,
  crossRefRule,
  articleNumberingRule,
  dateOrderRule,
  depositCapRule,
  orArbitrateOrSueRule,
  jurisdictionFormRule,
  signatureBlockRule,
  placeholderRule,
];

export const LEGAL_LINT_RULES: LegalLintRule[] = [
  ...CORE_LINT_RULES,
  ...GENERAL_EXTRA_LINT_RULES,
  ...SALE_LINT_RULES,
  ...LOAN_LINT_RULES,
  ...LEASE_LINT_RULES,
  ...EMPLOYMENT_LINT_RULES,
  ...EQUITY_LINT_RULES,
  ...CONSTRUCTION_LINT_RULES,
];
