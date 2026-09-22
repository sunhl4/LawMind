import {
  CHINESE_INTEGER_PATTERN,
  CHINESE_NUMERAL_PATTERN,
  parseChineseDecimal,
  parseChineseInteger,
} from "../chinese-numeral.js";
import { familyDeliverableMatches } from "../family-gate.js";
import { lintFinding as finding } from "../finding.js";
import { LEASE_TERM_MAX_YEARS } from "../statute-params.js";
import type { LegalLintContext, LegalLintFinding, LegalLintRule } from "../types.js";

const LEASE_FAMILY_TRIGGER = /租赁|出租|承租|房屋租赁/;

export function leaseFamilyApplies(text: string, ctx?: LegalLintContext): boolean {
  return LEASE_FAMILY_TRIGGER.test(text ?? "") && familyDeliverableMatches("lease", ctx);
}

const termRule: LegalLintRule = {
  id: "lease.term",
  family: "lease",
  run(text, ctx) {
    if (!leaseFamilyApplies(text, ctx) || /租期|租赁期限|起租/.test(text)) {
      return [];
    }
    return [finding(termRule, "warning", "租赁稿未见租期或起租日。")];
  },
};

const rentRule: LegalLintRule = {
  id: "lease.rent",
  family: "lease",
  run(text, ctx) {
    if (!leaseFamilyApplies(text, ctx) || /租金|房租|月租/.test(text)) {
      return [];
    }
    return [finding(rentRule, "warning", "租赁稿未见租金约定。")];
  },
};

/**
 * 租期解析：「X年」与「X年X个月」复合形态都认（中文/阿拉伯数字可混合，如
 * 「二十年六个月」「20年零3个月」）。窗口不跨逗号，避免跨分句误判。
 */
const LEASE_TERM_YEAR_RE = new RegExp(
  `(?:租期|租赁期限|租约)[^。，；、]{0,12}?(\\d+(?:\\.\\d+)?|${CHINESE_NUMERAL_PATTERN})\\s*年(?:(?:零|又)?\\s*(\\d+|${CHINESE_INTEGER_PATTERN})\\s*个?月)?`,
  "g",
);

const termCapRule: LegalLintRule = {
  id: "lease.term_cap",
  family: "lease",
  run(text, ctx) {
    if (!leaseFamilyApplies(text, ctx)) {
      return [];
    }
    const findings: LegalLintFinding[] = [];
    for (const m of text.matchAll(LEASE_TERM_YEAR_RE)) {
      const years = parseChineseDecimal(m[1] ?? "");
      // 上限 99 年：排除「租期自 2026 年起」这类公元纪年误命中。
      if (!Number.isFinite(years) || years >= 100) {
        continue;
      }
      const months = m[2] === undefined ? 0 : parseChineseInteger(m[2]);
      if (!Number.isFinite(months)) {
        continue;
      }
      const totalMonths = years * 12 + months;
      if (totalMonths > LEASE_TERM_MAX_YEARS.value * 12) {
        const termLabel = months > 0 ? `${years} 年 ${months} 个月` : `${years} 年`;
        findings.push(
          // 措辞待执业法律顾问复核
          finding(
            termCapRule,
            "blocker",
            `租赁期限 ${termLabel}超过法定上限 ${LEASE_TERM_MAX_YEARS.value} 年，超过部分无效。`,
            { statuteRef: LEASE_TERM_MAX_YEARS.source, anchor: m[0] },
          ),
        );
      }
    }
    return findings;
  },
};

const repairRule: LegalLintRule = {
  id: "lease.repair",
  family: "lease",
  run(text, ctx) {
    if (!leaseFamilyApplies(text, ctx) || /维修|修缮|损坏/.test(text)) {
      return [];
    }
    return [finding(repairRule, "info", "租赁稿未见维修或修缮分担。")];
  },
};

const subletRule: LegalLintRule = {
  id: "lease.sublet",
  family: "lease",
  run(text, ctx) {
    if (!leaseFamilyApplies(text, ctx) || /转租|分租/.test(text)) {
      return [];
    }
    return [finding(subletRule, "info", "租赁稿未见是否允许转租。")];
  },
};

const depositRule: LegalLintRule = {
  id: "lease.deposit",
  family: "lease",
  run(text, ctx) {
    if (!leaseFamilyApplies(text, ctx) || /押金|保证金|租赁保证金/.test(text)) {
      return [];
    }
    return [finding(depositRule, "warning", "租赁稿未见押金或保证金。")];
  },
};

const useRule: LegalLintRule = {
  id: "lease.use",
  family: "lease",
  run(text, ctx) {
    if (!leaseFamilyApplies(text, ctx) || /用途|使用目的/.test(text)) {
      return [];
    }
    return [finding(useRule, "info", "租赁稿未见房屋或场地用途。")];
  },
};

const returnRule: LegalLintRule = {
  id: "lease.return",
  family: "lease",
  run(text, ctx) {
    if (!leaseFamilyApplies(text, ctx) || /返还|交还|腾退|恢复原状/.test(text)) {
      return [];
    }
    return [finding(returnRule, "info", "租赁稿未见返还或腾退安排。")];
  },
};

const utilitiesRule: LegalLintRule = {
  id: "lease.utilities",
  family: "lease",
  run(text, ctx) {
    if (!leaseFamilyApplies(text, ctx) || /水电|物业|供暖|燃气/.test(text)) {
      return [];
    }
    return [finding(utilitiesRule, "info", "租赁稿未见水电或物业费用分担。")];
  },
};

export const LEASE_LINT_RULES: LegalLintRule[] = [
  termRule,
  rentRule,
  termCapRule,
  repairRule,
  subletRule,
  depositRule,
  useRule,
  returnRule,
  utilitiesRule,
];
