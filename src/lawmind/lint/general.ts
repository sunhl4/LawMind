import { lintFinding as finding } from "./finding.js";
import { DEFAULT_LIMITATION, PRIVATE_LENDING_LPR_MULTIPLE } from "./statute-params.js";
import type { LegalLintFinding, LegalLintRule } from "./types.js";

/** Advisory only — 违约金酌减常见阈值，不是法定上限。 */
const LIQUIDATED_DAMAGES_HIGH_RATIO = 0.3;

const liquidatedDamagesHighRule: LegalLintRule = {
  id: "statutory.liquidated_damages_high",
  family: "statutory_cap",
  run(text) {
    const findings: LegalLintFinding[] = [];
    for (const m of text.matchAll(/违约金[^。]{0,24}?(\d{1,2})\s*%/g)) {
      const pct = Number.parseInt(m[1] ?? "", 10);
      if (Number.isFinite(pct) && pct / 100 > LIQUIDATED_DAMAGES_HIGH_RATIO) {
        findings.push(
          finding(
            liquidatedDamagesHighRule,
            "warning",
            `违约金比例 ${pct}% 明显高于标的额的 ${LIQUIDATED_DAMAGES_HIGH_RATIO * 100}%，法院可能酌减。`,
            { anchor: m[0], statuteRef: "民法典第585条" },
          ),
        );
      }
    }
    return findings;
  },
};

const guaranteePeriodRule: LegalLintRule = {
  id: "form.guarantee_period",
  family: "form",
  run(text) {
    const hasGuarantee = /保证人|提供保证|一般保证|连带责任保证|连带保证/.test(text);
    if (!hasGuarantee || /保证期间/.test(text)) {
      return [];
    }
    return [
      finding(guaranteePeriodRule, "warning", "见保证条款，但未见保证期间。", {
        statuteRef: "民法典第692条",
      }),
    ];
  },
};

const annexListRule: LegalLintRule = {
  id: "consistency.annex_list",
  family: "consistency",
  run(text) {
    if (!/见附件|详见附件|如附件所示/.test(text)) {
      return [];
    }
    if (/附件(?:清单|目录|一|1|：|:)/.test(text)) {
      return [];
    }
    return [finding(annexListRule, "warning", "文中写「见附件」，但未见附件清单或附件一。")];
  },
};

const partyPairRule: LegalLintRule = {
  id: "consistency.party_pair",
  family: "consistency",
  run(text) {
    if (!/合同|协议/.test(text)) {
      return [];
    }
    const hasJia = /甲方/.test(text);
    const hasYi = /乙方/.test(text);
    if (hasJia === hasYi) {
      return [];
    }
    return [
      finding(
        partyPairRule,
        "warning",
        hasJia ? "合同主体只见甲方、未见乙方。" : "合同主体只见乙方、未见甲方。",
      ),
    ];
  },
};

const lprMultipleRule: LegalLintRule = {
  id: "statutory.lpr_multiple",
  family: "statutory_cap",
  run(text) {
    const hasLpr = /LPR|贷款市场报价利率/.test(text);
    if (!hasLpr) {
      return [];
    }
    const rates = [...text.matchAll(/(?:年利率|利率|利息)[^。]{0,24}?(\d+(?:\.\d+)?)\s*%/g)];
    if (rates.length === 0) {
      return [];
    }
    return [
      finding(
        lprMultipleRule,
        "info",
        `文中同时出现利率数字与 LPR。参数库仅锁定 ${PRIVATE_LENDING_LPR_MULTIPLE.value} 倍上限，无 LPR 历史序列，需人工核 LPR。`,
        { statuteRef: PRIVATE_LENDING_LPR_MULTIPLE.source, anchor: rates[0]?.[0] },
      ),
    ];
  },
};

const YEAR_TOKEN = "(?:[2-9]|[1-9]\\d|[四五六七八九十])";

const limitationPeriodRule: LegalLintRule = {
  id: "statutory.limitation_period",
  family: "statutory_cap",
  run(text) {
    if (!/诉讼时效|时效期间/.test(text)) {
      return [];
    }
    const findings: LegalLintFinding[] = [];
    if (/诉讼时效[^。]{0,20}超过\s*[三3]\s*年|时效期间[^。]{0,16}超过\s*[三3]\s*年/.test(text)) {
      findings.push(
        finding(
          limitationPeriodRule,
          "warning",
          `文中「超过三年」的时效表述与普通诉讼时效 ${DEFAULT_LIMITATION.value} 年不一致。`,
          { statuteRef: DEFAULT_LIMITATION.source },
        ),
      );
    }
    const assigned = new RegExp(
      `(?:诉讼时效|时效期间)[^。]{0,20}?(?:为|约定为)\\s*(${YEAR_TOKEN})\\s*年`,
      "g",
    );
    for (const m of text.matchAll(assigned)) {
      const raw = (m[1] ?? "").trim();
      const years = /^[四五六七八九十]$/.test(raw) ? chineseYear(raw) : Number.parseInt(raw, 10);
      if (Number.isFinite(years) && years !== DEFAULT_LIMITATION.value) {
        findings.push(
          finding(
            limitationPeriodRule,
            "warning",
            `时效期间写成 ${raw} 年，与普通诉讼时效 ${DEFAULT_LIMITATION.value} 年不一致。`,
            { statuteRef: DEFAULT_LIMITATION.source, anchor: m[0] },
          ),
        );
      }
    }
    return findings;
  },
};

function chineseYear(token: string): number {
  const map: Record<string, number> = {
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return map[token] ?? Number.NaN;
}

export const GENERAL_EXTRA_LINT_RULES: LegalLintRule[] = [
  liquidatedDamagesHighRule,
  guaranteePeriodRule,
  annexListRule,
  partyPairRule,
  lprMultipleRule,
  limitationPeriodRule,
];
