import {
  CHINESE_INTEGER_PATTERN,
  CHINESE_NUMERAL_PATTERN,
  parseChineseDecimal,
  parseChineseInteger,
} from "../chinese-numeral.js";
import { familyDeliverableMatches } from "../family-gate.js";
import { lintFinding as finding } from "../finding.js";
import {
  CONSTRUCTION_WARRANTY_HEATING_PERIODS,
  CONSTRUCTION_WARRANTY_MEP_YEARS,
  CONSTRUCTION_WARRANTY_ROOF_YEARS,
} from "../statute-params.js";
import type { LegalLintContext, LegalLintFinding, LegalLintRule } from "../types.js";

/** Bare 承包 is too broad (承包经营). Require a construction counterpart. */
const CONSTRUCTION_FAMILY_TRIGGER = /建工|施工|工程合同|建设工程|工程承包|施工承包|总承包/;

export function constructionFamilyApplies(text: string, ctx?: LegalLintContext): boolean {
  const body = text ?? "";
  const keywordHit =
    CONSTRUCTION_FAMILY_TRIGGER.test(body) ||
    (/承包/.test(body) && /发包人|承包人|工期|竣工/.test(body));
  return keywordHit && familyDeliverableMatches("construction", ctx);
}

const scheduleRule: LegalLintRule = {
  id: "construction.schedule",
  family: "construction",
  run(text, ctx) {
    if (!constructionFamilyApplies(text, ctx) || /工期|竣工|开工/.test(text)) {
      return [];
    }
    return [finding(scheduleRule, "warning", "建工稿未见工期、开工或竣工。")];
  },
};

const priceRule: LegalLintRule = {
  id: "construction.price",
  family: "construction",
  run(text, ctx) {
    if (!constructionFamilyApplies(text, ctx) || /工程价款|合同价款|进度款/.test(text)) {
      return [];
    }
    return [finding(priceRule, "warning", "建工稿未见工程价款或进度款。")];
  },
};

const qualityRule: LegalLintRule = {
  id: "construction.quality",
  family: "construction",
  run(text, ctx) {
    if (!constructionFamilyApplies(text, ctx) || /质量|验收|合格/.test(text)) {
      return [];
    }
    return [finding(qualityRule, "warning", "建工稿未见质量或验收约定。")];
  },
};

const changeRule: LegalLintRule = {
  id: "construction.change",
  family: "construction",
  run(text, ctx) {
    if (!constructionFamilyApplies(text, ctx) || /签证|变更|洽商/.test(text)) {
      return [];
    }
    return [finding(changeRule, "info", "建工稿未见变更或签证程序。")];
  },
};

const safetyRule: LegalLintRule = {
  id: "construction.safety",
  family: "construction",
  run(text, ctx) {
    if (!constructionFamilyApplies(text, ctx) || /安全|文明施工/.test(text)) {
      return [];
    }
    return [finding(safetyRule, "warning", "建工稿未见安全或文明施工约定。")];
  },
};

const delayRule: LegalLintRule = {
  id: "construction.delay",
  family: "construction",
  run(text, ctx) {
    if (!constructionFamilyApplies(text, ctx) || /工期延误|逾期竣工|误期/.test(text)) {
      return [];
    }
    return [finding(delayRule, "info", "建工稿未见工期延误后果。")];
  },
};

const warrantyRule: LegalLintRule = {
  id: "construction.warranty",
  family: "construction",
  run(text, ctx) {
    if (!constructionFamilyApplies(text, ctx) || /保修|缺陷责任/.test(text)) {
      return [];
    }
    return [finding(warrantyRule, "warning", "建工稿未见保修或缺陷责任。")];
  },
};

const WARRANTY_NUM = `(\\d+(?:\\.\\d+)?|${CHINESE_NUMERAL_PATTERN})`;
// 类别词在前、年限在后且窗口不跨逗号：「保修 3 年，范围含屋面防水」这类倒装保守不判。
const WARRANTY_ROOF_YEAR_RE = new RegExp(`屋面防水[^。，；、]{0,16}?${WARRANTY_NUM}\\s*年`, "g");
const WARRANTY_MEP_YEAR_RE = new RegExp(
  `(?:电气管线|给排水|给水排水|设备安装|装修)[^。，；、]{0,16}?${WARRANTY_NUM}\\s*年`,
  "g",
);
const WARRANTY_HEATING_RE = new RegExp(
  `(?:供热|供冷)[^。，；、]{0,16}?(\\d+|${CHINESE_INTEGER_PATTERN})\\s*个?(?:采暖|供冷)期`,
  "g",
);

/**
 * 保修期低于法定下限（建设工程质量管理条例 §40）。只判「类别词 + 年限/期数」正向表述；
 * 地基基础与主体结构的「设计文件规定的合理使用年限」非确定数值，保守不判。
 */
const warrantyFloorRule: LegalLintRule = {
  id: "construction.warranty_floor",
  family: "construction",
  run(text, ctx) {
    if (!constructionFamilyApplies(text, ctx) || !/保修/.test(text)) {
      return [];
    }
    const findings: LegalLintFinding[] = [];
    for (const m of text.matchAll(WARRANTY_ROOF_YEAR_RE)) {
      const years = parseChineseDecimal(m[1] ?? "");
      if (Number.isFinite(years) && years < CONSTRUCTION_WARRANTY_ROOF_YEARS.value) {
        findings.push(
          // 措辞待执业法律顾问复核
          finding(
            warrantyFloorRule,
            "blocker",
            `屋面防水保修 ${years} 年低于法定最低保修期 ${CONSTRUCTION_WARRANTY_ROOF_YEARS.value} 年。`,
            { statuteRef: CONSTRUCTION_WARRANTY_ROOF_YEARS.source, anchor: m[0] },
          ),
        );
      }
    }
    for (const m of text.matchAll(WARRANTY_MEP_YEAR_RE)) {
      const years = parseChineseDecimal(m[1] ?? "");
      if (Number.isFinite(years) && years < CONSTRUCTION_WARRANTY_MEP_YEARS.value) {
        findings.push(
          // 措辞待执业法律顾问复核
          finding(
            warrantyFloorRule,
            "blocker",
            `电气管线/给排水/设备安装/装修保修 ${years} 年低于法定最低保修期 ${CONSTRUCTION_WARRANTY_MEP_YEARS.value} 年。`,
            { statuteRef: CONSTRUCTION_WARRANTY_MEP_YEARS.source, anchor: m[0] },
          ),
        );
      }
    }
    for (const m of text.matchAll(WARRANTY_HEATING_RE)) {
      const periods = parseChineseInteger(m[1] ?? "");
      if (Number.isFinite(periods) && periods < CONSTRUCTION_WARRANTY_HEATING_PERIODS.value) {
        findings.push(
          // 措辞待执业法律顾问复核
          finding(
            warrantyFloorRule,
            "blocker",
            `供热/供冷系统保修 ${periods} 个采暖/供冷期低于法定最低 ${CONSTRUCTION_WARRANTY_HEATING_PERIODS.value} 个采暖期、供冷期。`,
            { statuteRef: CONSTRUCTION_WARRANTY_HEATING_PERIODS.source, anchor: m[0] },
          ),
        );
      }
    }
    return findings;
  },
};

const paymentNodeRule: LegalLintRule = {
  id: "construction.payment_node",
  family: "construction",
  run(text, ctx) {
    if (!constructionFamilyApplies(text, ctx) || /付款节点|节点付款|形象进度/.test(text)) {
      return [];
    }
    return [finding(paymentNodeRule, "info", "建工稿未见付款节点。")];
  },
};

export const CONSTRUCTION_LINT_RULES: LegalLintRule[] = [
  scheduleRule,
  priceRule,
  qualityRule,
  changeRule,
  safetyRule,
  delayRule,
  warrantyRule,
  warrantyFloorRule,
  paymentNodeRule,
];
