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
    const defined = new Set(
      [...text.matchAll(/[「“"]([^」”"]{1,20})[」”"]\s*[（(]以[下下]简[称称]/g)].map((m) => m[1]),
    );
    if (defined.size === 0 && !/定义条款|释义/.test(text) && /第\s*1\s*条/.test(text)) {
      findings.push(
        finding(definedTermsRule, "info", "未见定义条款或「以下简称」表述，专有名词可能未统一。"),
      );
    }
    return findings;
  },
};

const crossRefRule: LegalLintRule = {
  id: "consistency.cross_ref",
  family: "consistency",
  run(text) {
    const findings: LegalLintFinding[] = [];
    const mentioned = new Set(
      [...text.matchAll(/第\s*(\d+)\s*条/g)].map((m) => Number.parseInt(m[1] ?? "", 10)),
    );
    const dangling = [...text.matchAll(/见第\s*(\d+)\s*条|按第\s*(\d+)\s*条/g)]
      .map((m) => Number.parseInt(m[1] ?? m[2] ?? "", 10))
      .filter((n) => Number.isFinite(n) && !mentioned.has(n));
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
    const nums = [...text.matchAll(/第\s*(\d+)\s*条/g)]
      .map((m) => Number.parseInt(m[1] ?? "", 10))
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

const depositCapRule: LegalLintRule = {
  id: "statutory.deposit_cap",
  family: "statutory_cap",
  run(text) {
    if (!/定金/.test(text)) {
      return [];
    }
    const findings: LegalLintFinding[] = [];
    const ratio = [...text.matchAll(/定金[^。]{0,24}?(\d{1,2})\s*%/g)];
    for (const m of ratio) {
      const pct = Number.parseInt(m[1] ?? "", 10);
      if (Number.isFinite(pct) && pct / 100 > DEPOSIT_CAP.value) {
        findings.push(
          finding(
            depositCapRule,
            "blocker",
            `定金比例 ${pct}% 超过法定上限 ${DEPOSIT_CAP.value * 100}%。`,
            {
              statuteRef: DEPOSIT_CAP.source,
              fixable: true,
              anchor: m[0],
            },
          ),
        );
      }
    }
    return findings;
  },
};

const orArbitrateOrSueRule: LegalLintRule = {
  id: "form.or_arbitrate_or_sue",
  family: "form",
  run(text) {
    const both =
      /仲裁/.test(text) &&
      /起诉|提起诉讼|人民法院/.test(text) &&
      /或仲裁或诉讼|既可以.*仲裁.*也可以.*(诉讼|起诉)|仲裁或向/.test(text);
    if (both) {
      return [
        finding(
          orArbitrateOrSueRule,
          "blocker",
          "争议解决同时指向仲裁与诉讼（或裁或诉），形式可能无效。",
          {
            statuteRef: "仲裁法第16条 / 民诉法解释",
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
];
