import { lintFinding as finding } from "./finding.js";
import {
  DEFAULT_LIMITATION,
  GUARANTEE_DEFAULT_GENERAL,
  PRIVATE_LENDING_LPR_MULTIPLE,
} from "./statute-params.js";
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
            // 措辞待执业法律顾问复核：30% 基准相对「造成的损失」（原合同法解释二 §29 口径），非标的额。
            `违约金比例 ${pct}% 明显高于「造成的损失」的 ${LIQUIDATED_DAMAGES_HIGH_RATIO * 100}% 基准，超过该基准可能被法院酌减。`,
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

const guaranteeFormDefaultRule: LegalLintRule = {
  id: "form.guarantee_form_default",
  family: "form",
  run(text) {
    // 触发词保守限定在保证责任语境，避免「保证金/质量保证」类表述误报。
    const hasGuarantee = /保证人|承担保证责任/.test(text);
    if (!hasGuarantee || /一般保证|连带责任保证|连带保证/.test(text)) {
      return [];
    }
    return [
      // 措辞待执业法律顾问复核：民法典 §686 默认一般保证，与旧担保法连带默认相反。
      finding(
        guaranteeFormDefaultRule,
        "info",
        "保证条款未明确保证方式；按民法典第686条默认一般保证（与旧担保法的连带默认相反），如需连带责任保证应明示。",
        { statuteRef: GUARANTEE_DEFAULT_GENERAL.source },
      ),
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

// 「两/二/三」纳入 token：「诉讼时效为两年」是民法典前的旧口径，须能识别提示；三被 years!==3 过滤，不会自触发。
const YEAR_TOKEN = "(?:[2-9]|[1-9]\\d|[二三四五六七八九十两])";

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
      const years = /^[二三四五六七八九十两]$/.test(raw)
        ? chineseYear(raw)
        : Number.parseInt(raw, 10);
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
    二: 2,
    两: 2,
    三: 3,
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

/**
 * 民间借贷利率旧「两线三区」口径（24%/36%）：2020-08-20 起司法保护上限改为合同成立时
 * 一年期 LPR 四倍。LPR 历史序列不在库——只提示口径变更，不核算具体数值（保持诚实）。
 * 已提及 LPR 的文本说明起草者已知新口径，不再提示。
 */
const legacyRateCapRule: LegalLintRule = {
  id: "statutory.lpr_legacy_rate",
  family: "statutory_cap",
  run(text) {
    if (!/借款|借贷|贷款/.test(text) || /LPR|贷款市场报价利率/.test(text)) {
      return [];
    }
    const m = /(?:年利率|月利率|利率|利息)[^。]{0,16}?(?<![\d.])(24|36)\s*%/.exec(text);
    if (!m) {
      return [];
    }
    return [
      // 措辞待执业法律顾问复核
      finding(
        legacyRateCapRule,
        "info",
        `文中 ${m[1]}% 利率与已调整的「两线三区」旧口径（24%/36%）相同；现行民间借贷司法保护上限为合同成立时一年期 LPR 四倍（LPR 序列不在库，未核算具体数值）。`,
        { statuteRef: PRIVATE_LENDING_LPR_MULTIPLE.source, anchor: m[0] },
      ),
    ];
  },
};

const LONG_CONTRACT = 400;

const effectiveDateRule: LegalLintRule = {
  id: "form.effective_date",
  family: "form",
  run(text) {
    if (text.length < LONG_CONTRACT || !/合同|协议/.test(text) || /生效/.test(text)) {
      return [];
    }
    return [finding(effectiveDateRule, "info", "较长合同/协议未见生效日约定。")];
  },
};

const noticeRule: LegalLintRule = {
  id: "form.notice",
  family: "form",
  run(text) {
    if (text.length < LONG_CONTRACT || !/合同|协议/.test(text) || /通知/.test(text)) {
      return [];
    }
    return [finding(noticeRule, "info", "较长合同/协议未见通知送达约定。")];
  },
};

const assignmentRule: LegalLintRule = {
  id: "form.assignment",
  family: "form",
  run(text) {
    if (text.length < LONG_CONTRACT || !/合同|协议/.test(text) || /转让/.test(text)) {
      return [];
    }
    return [finding(assignmentRule, "info", "较长合同/协议未见权利义务可否转让。")];
  },
};

const currencyRule: LegalLintRule = {
  id: "consistency.currency",
  family: "consistency",
  run(text) {
    const money = [...text.matchAll(/([0-9][0-9,]{2,})\s*元/g)];
    if (money.length < 2 || /人民币|美元|欧元|港币/.test(text)) {
      return [];
    }
    return [finding(currencyRule, "info", "出现多处金额，未见币种（人民币/美元等）。")];
  },
};

export const GENERAL_EXTRA_LINT_RULES: LegalLintRule[] = [
  liquidatedDamagesHighRule,
  guaranteePeriodRule,
  guaranteeFormDefaultRule,
  annexListRule,
  partyPairRule,
  lprMultipleRule,
  legacyRateCapRule,
  limitationPeriodRule,
  effectiveDateRule,
  noticeRule,
  assignmentRule,
  currencyRule,
];
