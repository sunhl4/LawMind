import { familyDeliverableMatches } from "../family-gate.js";
import { lintFinding as finding } from "../finding.js";
import type { LegalLintContext, LegalLintRule } from "../types.js";

const SALE_FAMILY_TRIGGER = /买卖|供货|采购/;

export function saleFamilyApplies(text: string, ctx?: LegalLintContext): boolean {
  return SALE_FAMILY_TRIGGER.test(text ?? "") && familyDeliverableMatches("sale", ctx);
}

const acceptanceRule: LegalLintRule = {
  id: "sale.acceptance",
  family: "sale",
  run(text, ctx) {
    if (!saleFamilyApplies(text, ctx) || /验收|检验期|异议期/.test(text)) {
      return [];
    }
    return [finding(acceptanceRule, "warning", "买卖/供货稿未见验收或异议期限。")];
  },
};

const deliveryRule: LegalLintRule = {
  id: "sale.delivery",
  family: "sale",
  run(text, ctx) {
    if (!saleFamilyApplies(text, ctx) || /交付|交货|装运/.test(text)) {
      return [];
    }
    return [finding(deliveryRule, "warning", "买卖/供货稿未见交付或交货安排。")];
  },
};

const qualitySpecRule: LegalLintRule = {
  id: "sale.quality_spec",
  family: "sale",
  run(text, ctx) {
    if (!saleFamilyApplies(text, ctx) || /质量标准|规格型号|技术标准|国家标准/.test(text)) {
      return [];
    }
    return [finding(qualitySpecRule, "warning", "买卖/供货稿未见质量标准或规格。")];
  },
};

const riskRule: LegalLintRule = {
  id: "sale.risk",
  family: "sale",
  run(text, ctx) {
    if (!saleFamilyApplies(text, ctx) || /风险转移|毁损、灭失|毁损灭失/.test(text)) {
      return [];
    }
    return [finding(riskRule, "info", "买卖/供货稿未见风险转移或毁损灭失约定。")];
  },
};

const priceRule: LegalLintRule = {
  id: "sale.price",
  family: "sale",
  run(text, ctx) {
    if (!saleFamilyApplies(text, ctx) || /价款|单价|总价|合同金额/.test(text)) {
      return [];
    }
    return [finding(priceRule, "warning", "买卖/供货稿未见价款或单价。")];
  },
};

const quantityRule: LegalLintRule = {
  id: "sale.quantity",
  family: "sale",
  run(text, ctx) {
    if (!saleFamilyApplies(text, ctx) || /数量|件数|吨|台|套/.test(text)) {
      return [];
    }
    return [finding(quantityRule, "info", "买卖/供货稿未见数量约定。")];
  },
};

const ownershipRule: LegalLintRule = {
  id: "sale.ownership",
  family: "sale",
  run(text, ctx) {
    if (!saleFamilyApplies(text, ctx) || /所有权|货权|产权转移/.test(text)) {
      return [];
    }
    return [finding(ownershipRule, "info", "买卖/供货稿未见所有权或货权转移。")];
  },
};

const warrantyRule: LegalLintRule = {
  id: "sale.warranty",
  family: "sale",
  run(text, ctx) {
    if (!saleFamilyApplies(text, ctx) || /保修|质量保证|质保/.test(text)) {
      return [];
    }
    return [finding(warrantyRule, "info", "买卖/供货稿未见保修或质量保证。")];
  },
};

export const SALE_LINT_RULES: LegalLintRule[] = [
  acceptanceRule,
  deliveryRule,
  qualitySpecRule,
  riskRule,
  priceRule,
  quantityRule,
  ownershipRule,
  warrantyRule,
];
