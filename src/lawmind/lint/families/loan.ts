import { familyDeliverableMatches } from "../family-gate.js";
import { lintFinding as finding } from "../finding.js";
import type { LegalLintContext, LegalLintRule } from "../types.js";

const LOAN_FAMILY_TRIGGER = /借款|借贷|贷款/;

export function loanFamilyApplies(text: string, ctx?: LegalLintContext): boolean {
  return LOAN_FAMILY_TRIGGER.test(text ?? "") && familyDeliverableMatches("loan", ctx);
}

const repaymentRule: LegalLintRule = {
  id: "loan.repayment",
  family: "loan",
  run(text, ctx) {
    if (!loanFamilyApplies(text, ctx) || /还款|偿还|还本/.test(text)) {
      return [];
    }
    return [finding(repaymentRule, "warning", "借款稿未见还款或偿还安排。")];
  },
};

const interestRule: LegalLintRule = {
  id: "loan.interest",
  family: "loan",
  run(text, ctx) {
    if (!loanFamilyApplies(text, ctx) || /利息|利率|无息/.test(text)) {
      return [];
    }
    return [finding(interestRule, "warning", "借款稿未见利息、利率或无息约定。")];
  },
};

const termRule: LegalLintRule = {
  id: "loan.term",
  family: "loan",
  run(text, ctx) {
    if (!loanFamilyApplies(text, ctx) || /借款期限|还款日|还款日期|届满/.test(text)) {
      return [];
    }
    return [finding(termRule, "warning", "借款稿未见借款期限或还款日。")];
  },
};

const principalRule: LegalLintRule = {
  id: "loan.principal",
  family: "loan",
  run(text, ctx) {
    if (!loanFamilyApplies(text, ctx) || /本金|借款金额|贷款金额/.test(text)) {
      return [];
    }
    return [finding(principalRule, "warning", "借款稿未见本金或借款金额。")];
  },
};

const defaultRule: LegalLintRule = {
  id: "loan.default",
  family: "loan",
  run(text, ctx) {
    if (!loanFamilyApplies(text, ctx) || /逾期|违约|提前到期/.test(text)) {
      return [];
    }
    return [finding(defaultRule, "warning", "借款稿未见逾期或违约后果。")];
  },
};

const purposeRule: LegalLintRule = {
  id: "loan.purpose",
  family: "loan",
  run(text, ctx) {
    if (!loanFamilyApplies(text, ctx) || /借款用途|贷款用途|资金用途/.test(text)) {
      return [];
    }
    return [finding(purposeRule, "info", "借款稿未见借款用途。")];
  },
};

const prepayRule: LegalLintRule = {
  id: "loan.prepay",
  family: "loan",
  run(text, ctx) {
    if (!loanFamilyApplies(text, ctx) || /提前还款|提前偿还/.test(text)) {
      return [];
    }
    return [finding(prepayRule, "info", "借款稿未见是否允许提前还款。")];
  },
};

const securityRule: LegalLintRule = {
  id: "loan.security",
  family: "loan",
  run(text, ctx) {
    if (!loanFamilyApplies(text, ctx) || /担保|抵押|质押|保证/.test(text)) {
      return [];
    }
    return [finding(securityRule, "info", "借款稿未见担保、抵押或保证安排。")];
  },
};

export const LOAN_LINT_RULES: LegalLintRule[] = [
  repaymentRule,
  interestRule,
  termRule,
  principalRule,
  defaultRule,
  purposeRule,
  prepayRule,
  securityRule,
];
