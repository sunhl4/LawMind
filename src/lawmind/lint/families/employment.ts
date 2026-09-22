import { CHINESE_NUMERAL_PATTERN, parseChineseDecimal } from "../chinese-numeral.js";
import { familyDeliverableMatches } from "../family-gate.js";
import { lintFinding as finding } from "../finding.js";
import { NONCOMPETE_MAX_YEARS, PROBATION_MAX_MONTHS } from "../statute-params.js";
import type { LegalLintContext, LegalLintFinding, LegalLintRule } from "../types.js";

const EMPLOYMENT_FAMILY_TRIGGER = /劳动|雇佣|聘用|劳动合同/;

export function employmentFamilyApplies(text: string, ctx?: LegalLintContext): boolean {
  return EMPLOYMENT_FAMILY_TRIGGER.test(text ?? "") && familyDeliverableMatches("employment", ctx);
}

const postRule: LegalLintRule = {
  id: "employment.post",
  family: "employment",
  run(text, ctx) {
    if (!employmentFamilyApplies(text, ctx) || /岗位|职务|工作内容/.test(text)) {
      return [];
    }
    return [finding(postRule, "warning", "劳动稿未见岗位或工作内容。")];
  },
};

const payRule: LegalLintRule = {
  id: "employment.pay",
  family: "employment",
  run(text, ctx) {
    if (!employmentFamilyApplies(text, ctx) || /工资|报酬|薪酬|劳动报酬/.test(text)) {
      return [];
    }
    return [finding(payRule, "warning", "劳动稿未见工资或劳动报酬。")];
  },
};

const termRule: LegalLintRule = {
  id: "employment.term",
  family: "employment",
  run(text, ctx) {
    if (!employmentFamilyApplies(text, ctx) || /合同期限|无固定期限|试用期/.test(text)) {
      return [];
    }
    return [finding(termRule, "warning", "劳动稿未见合同期限或试用期。")];
  },
};

const terminateRule: LegalLintRule = {
  id: "employment.terminate",
  family: "employment",
  run(text, ctx) {
    if (!employmentFamilyApplies(text, ctx) || /解除|终止|竞业/.test(text)) {
      return [];
    }
    return [finding(terminateRule, "info", "劳动稿未见解除、终止或竞业限制。")];
  },
};

const NUM = `(\\d+(?:\\.\\d+)?|${CHINESE_NUMERAL_PATTERN})`;
// 关联窗口不跨逗号/分号：避免「试用期二个月，合同期限一年」被跨分句错配。
const PROBATION_MONTH_RE = new RegExp(`试用期[^。，；、]{0,16}?${NUM}\\s*个?月`, "g");
const PROBATION_YEAR_RE = new RegExp(`试用期[^。，；、]{0,16}?${NUM}\\s*年`, "g");
const CONTRACT_TERM_MONTH_RE = new RegExp(`合同期(?:限)?[^。，；、]{0,16}?${NUM}\\s*个?月`);
const CONTRACT_TERM_YEAR_RE = new RegExp(`合同期(?:限)?[^。，；、]{0,16}?${NUM}\\s*年`);

/** 试用期上限阶梯（月）：合同期 <3 月不得约定；3 月–1 年→1；1–3 年→2；≥3 年/无固定→6。 */
function probationCapMonths(
  termMonths: number | undefined,
  indefinite: boolean,
): number | undefined {
  if (indefinite) {
    return PROBATION_MAX_MONTHS.value;
  }
  if (termMonths === undefined) {
    return undefined;
  }
  if (termMonths < 3) {
    return 0;
  }
  if (termMonths < 12) {
    return 1;
  }
  if (termMonths < 36) {
    return 2;
  }
  return PROBATION_MAX_MONTHS.value;
}

function parseProbationMonths(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PROBATION_MONTH_RE)) {
    const v = parseChineseDecimal(m[1] ?? "");
    if (Number.isFinite(v)) {
      out.push(v);
    }
  }
  for (const m of text.matchAll(PROBATION_YEAR_RE)) {
    const v = parseChineseDecimal(m[1] ?? "");
    if (Number.isFinite(v)) {
      out.push(v * 12);
    }
  }
  return out;
}

function parseContractTermMonths(text: string): number | undefined {
  // 先年后月：「一年六个月」按年档归类，避免把零头月误当合同期。
  const y = CONTRACT_TERM_YEAR_RE.exec(text);
  if (y) {
    const v = parseChineseDecimal(y[1] ?? "");
    // 排除「合同期限自 2026 年起」这类公元纪年：按未识别处理（保守）。
    if (!Number.isFinite(v) || v >= 100) {
      return undefined;
    }
    return v * 12;
  }
  const m = CONTRACT_TERM_MONTH_RE.exec(text);
  if (m) {
    const v = parseChineseDecimal(m[1] ?? "");
    return Number.isFinite(v) ? v : undefined;
  }
  return undefined;
}

const probationRule: LegalLintRule = {
  id: "employment.probation_cap",
  family: "employment",
  run(text, ctx) {
    if (!employmentFamilyApplies(text, ctx) || !/试用期/.test(text)) {
      return [];
    }
    const findings: LegalLintFinding[] = [];
    const taskBased = /以完成一定工作任务为期限/.test(text);
    const indefinite = /无固定期限/.test(text);
    const termMonths = parseContractTermMonths(text);
    // 措辞待执业法律顾问复核（以下两条消息）
    if (taskBased || (termMonths !== undefined && termMonths < 3)) {
      findings.push(
        finding(
          probationRule,
          "blocker",
          taskBased
            ? "以完成一定工作任务为期限的劳动合同不得约定试用期。"
            : "合同期不满三个月却约定试用期，依法不得约定。",
          { statuteRef: PROBATION_MAX_MONTHS.source },
        ),
      );
      return findings;
    }
    const cap = probationCapMonths(termMonths, indefinite) ?? PROBATION_MAX_MONTHS.value;
    for (const p of parseProbationMonths(text)) {
      if (p > cap) {
        findings.push(
          finding(
            probationRule,
            "blocker",
            `试用期 ${p} 个月超过法定上限 ${cap} 个月（按合同期限阶梯）。`,
            { statuteRef: PROBATION_MAX_MONTHS.source },
          ),
        );
      }
    }
    return findings;
  },
};

const NONCOMPETE_YEAR_RE = new RegExp(`竞业限制[^。，；、]{0,16}?${NUM}\\s*年`, "g");
const NONCOMPETE_MONTH_RE = new RegExp(`竞业限制[^。，；、]{0,16}?${NUM}\\s*个?月`, "g");

const noncompeteCapRule: LegalLintRule = {
  id: "employment.noncompete_cap",
  family: "employment",
  run(text, ctx) {
    if (!employmentFamilyApplies(text, ctx) || !/竞业限制/.test(text)) {
      return [];
    }
    const findings: LegalLintFinding[] = [];
    for (const m of text.matchAll(NONCOMPETE_YEAR_RE)) {
      const years = parseChineseDecimal(m[1] ?? "");
      // 上限 99 年：排除公元纪年误命中。
      if (Number.isFinite(years) && years > NONCOMPETE_MAX_YEARS.value && years < 100) {
        findings.push(
          // 措辞待执业法律顾问复核
          finding(
            noncompeteCapRule,
            "blocker",
            `竞业限制期限 ${years} 年超过法定上限 ${NONCOMPETE_MAX_YEARS.value} 年。`,
            { statuteRef: NONCOMPETE_MAX_YEARS.source, anchor: m[0] },
          ),
        );
      }
    }
    for (const m of text.matchAll(NONCOMPETE_MONTH_RE)) {
      const months = parseChineseDecimal(m[1] ?? "");
      if (Number.isFinite(months) && months > NONCOMPETE_MAX_YEARS.value * 12) {
        findings.push(
          finding(
            noncompeteCapRule,
            "blocker",
            `竞业限制期限 ${months} 个月超过法定上限 ${NONCOMPETE_MAX_YEARS.value * 12} 个月。`,
            { statuteRef: NONCOMPETE_MAX_YEARS.source, anchor: m[0] },
          ),
        );
      }
    }
    return findings;
  },
};

const hoursRule: LegalLintRule = {
  id: "employment.hours",
  family: "employment",
  run(text, ctx) {
    if (!employmentFamilyApplies(text, ctx) || /工时|工作时间|工作日/.test(text)) {
      return [];
    }
    return [finding(hoursRule, "info", "劳动稿未见工作时间或工时。")];
  },
};

const socialRule: LegalLintRule = {
  id: "employment.social",
  family: "employment",
  run(text, ctx) {
    if (!employmentFamilyApplies(text, ctx) || /社保|社会保险|公积金/.test(text)) {
      return [];
    }
    return [finding(socialRule, "warning", "劳动稿未见社保或公积金。")];
  },
};

const placeRule: LegalLintRule = {
  id: "employment.place",
  family: "employment",
  run(text, ctx) {
    if (!employmentFamilyApplies(text, ctx) || /工作地点|工作地/.test(text)) {
      return [];
    }
    return [finding(placeRule, "info", "劳动稿未见工作地点。")];
  },
};

const confidentialRule: LegalLintRule = {
  id: "employment.confidential",
  family: "employment",
  run(text, ctx) {
    if (!employmentFamilyApplies(text, ctx) || /保密|商业秘密/.test(text)) {
      return [];
    }
    return [finding(confidentialRule, "info", "劳动稿未见保密约定。")];
  },
};

export const EMPLOYMENT_LINT_RULES: LegalLintRule[] = [
  postRule,
  payRule,
  termRule,
  terminateRule,
  probationRule,
  noncompeteCapRule,
  hoursRule,
  socialRule,
  placeRule,
  confidentialRule,
];
