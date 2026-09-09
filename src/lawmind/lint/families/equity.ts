import { familyDeliverableMatches } from "../family-gate.js";
import { lintFinding as finding } from "../finding.js";
import type { LegalLintContext, LegalLintRule } from "../types.js";

const EQUITY_FAMILY_TRIGGER = /股权|增资|转股|股东协议|投资协议/;

export function equityFamilyApplies(text: string, ctx?: LegalLintContext): boolean {
  return EQUITY_FAMILY_TRIGGER.test(text ?? "") && familyDeliverableMatches("equity", ctx);
}

const ratioRule: LegalLintRule = {
  id: "equity.ratio",
  family: "equity",
  run(text, ctx) {
    if (!equityFamilyApplies(text, ctx) || /股权比例|持股|出资额/.test(text)) {
      return [];
    }
    return [finding(ratioRule, "warning", "股权稿未见持股或出资比例。")];
  },
};

const priceRule: LegalLintRule = {
  id: "equity.price",
  family: "equity",
  run(text, ctx) {
    if (!equityFamilyApplies(text, ctx) || /对价|转让价款|估值|投资款/.test(text)) {
      return [];
    }
    return [finding(priceRule, "warning", "股权稿未见对价、价款或估值。")];
  },
};

const closingRule: LegalLintRule = {
  id: "equity.closing",
  family: "equity",
  run(text, ctx) {
    if (!equityFamilyApplies(text, ctx) || /交割|工商变更|登记/.test(text)) {
      return [];
    }
    return [finding(closingRule, "warning", "股权稿未见交割或工商变更。")];
  },
};

const repsRule: LegalLintRule = {
  id: "equity.reps",
  family: "equity",
  run(text, ctx) {
    if (!equityFamilyApplies(text, ctx) || /陈述|保证|承诺/.test(text)) {
      return [];
    }
    return [finding(repsRule, "info", "股权稿未见陈述与保证。")];
  },
};

const preemptiveRule: LegalLintRule = {
  id: "equity.preemptive",
  family: "equity",
  run(text, ctx) {
    if (!equityFamilyApplies(text, ctx) || /优先购买|优先权/.test(text)) {
      return [];
    }
    return [finding(preemptiveRule, "info", "股权稿未见优先购买权。")];
  },
};

const lockupRule: LegalLintRule = {
  id: "equity.lockup",
  family: "equity",
  run(text, ctx) {
    if (!equityFamilyApplies(text, ctx) || /限售|锁定期|禁售/.test(text)) {
      return [];
    }
    return [finding(lockupRule, "info", "股权稿未见限售或锁定期。")];
  },
};

const boardRule: LegalLintRule = {
  id: "equity.board",
  family: "equity",
  run(text, ctx) {
    if (!equityFamilyApplies(text, ctx) || /董事会|股东会|治理/.test(text)) {
      return [];
    }
    return [finding(boardRule, "info", "股权稿未见董事会或股东会安排。")];
  },
};

const antiDilutionRule: LegalLintRule = {
  id: "equity.anti_dilution",
  family: "equity",
  run(text, ctx) {
    if (!equityFamilyApplies(text, ctx) || /反稀释|优先认购/.test(text)) {
      return [];
    }
    return [finding(antiDilutionRule, "info", "股权稿未见反稀释或优先认购。")];
  },
};

export const EQUITY_LINT_RULES: LegalLintRule[] = [
  ratioRule,
  priceRule,
  closingRule,
  repsRule,
  preemptiveRule,
  lockupRule,
  boardRule,
  antiDilutionRule,
];
