import { lintFinding as finding } from "../finding.js";
import type { LegalLintRule } from "../types.js";

export const SALE_FAMILY_TRIGGER = /买卖|供货|采购/;

export function saleFamilyApplies(text: string): boolean {
  return SALE_FAMILY_TRIGGER.test(text ?? "");
}

const acceptanceRule: LegalLintRule = {
  id: "sale.acceptance",
  family: "sale",
  run(text) {
    if (!saleFamilyApplies(text) || /验收|检验期|异议期/.test(text)) {
      return [];
    }
    return [finding(acceptanceRule, "warning", "买卖/供货稿未见验收或异议期限。")];
  },
};

const deliveryRule: LegalLintRule = {
  id: "sale.delivery",
  family: "sale",
  run(text) {
    if (!saleFamilyApplies(text) || /交付|交货|装运/.test(text)) {
      return [];
    }
    return [finding(deliveryRule, "warning", "买卖/供货稿未见交付或交货安排。")];
  },
};

const qualitySpecRule: LegalLintRule = {
  id: "sale.quality_spec",
  family: "sale",
  run(text) {
    if (!saleFamilyApplies(text) || /质量标准|规格型号|技术标准|国家标准/.test(text)) {
      return [];
    }
    return [finding(qualitySpecRule, "warning", "买卖/供货稿未见质量标准或规格。")];
  },
};

const riskRule: LegalLintRule = {
  id: "sale.risk",
  family: "sale",
  run(text) {
    if (!saleFamilyApplies(text) || /风险转移|毁损、灭失|毁损灭失/.test(text)) {
      return [];
    }
    return [finding(riskRule, "info", "买卖/供货稿未见风险转移或毁损灭失约定。")];
  },
};

export const SALE_LINT_RULES: LegalLintRule[] = [
  acceptanceRule,
  deliveryRule,
  qualitySpecRule,
  riskRule,
];
