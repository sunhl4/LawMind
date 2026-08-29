import { lintFinding as finding } from "../finding.js";
import type { LegalLintRule } from "../types.js";

export const LOAN_FAMILY_TRIGGER = /借款|借贷|贷款/;

export function loanFamilyApplies(text: string): boolean {
  return LOAN_FAMILY_TRIGGER.test(text ?? "");
}

const repaymentRule: LegalLintRule = {
  id: "loan.repayment",
  family: "loan",
  run(text) {
    if (!loanFamilyApplies(text) || /还款|偿还|还本/.test(text)) {
      return [];
    }
    return [finding(repaymentRule, "warning", "借款稿未见还款或偿还安排。")];
  },
};

const interestRule: LegalLintRule = {
  id: "loan.interest",
  family: "loan",
  run(text) {
    if (!loanFamilyApplies(text) || /利息|利率|无息/.test(text)) {
      return [];
    }
    return [finding(interestRule, "warning", "借款稿未见利息、利率或无息约定。")];
  },
};

const termRule: LegalLintRule = {
  id: "loan.term",
  family: "loan",
  run(text) {
    if (!loanFamilyApplies(text) || /借款期限|还款日|还款日期|届满/.test(text)) {
      return [];
    }
    return [finding(termRule, "warning", "借款稿未见借款期限或还款日。")];
  },
};

const principalRule: LegalLintRule = {
  id: "loan.principal",
  family: "loan",
  run(text) {
    if (!loanFamilyApplies(text) || /本金|借款金额|贷款金额/.test(text)) {
      return [];
    }
    return [finding(principalRule, "warning", "借款稿未见本金或借款金额。")];
  },
};

export const LOAN_LINT_RULES: LegalLintRule[] = [
  repaymentRule,
  interestRule,
  termRule,
  principalRule,
];
