/**
 * v0 rule set for Chinese sales / general commercial contracts.
 * Extracted from `skills/builtin/contract-playbook-review.md` 底线项 × 纸别.
 * Same clause text may classify differently on own vs counterparty paper.
 */

import type { ReviewRule } from "../rules.js";

const SRC = "skills/builtin/contract-playbook-review.md#底线项";

function pair(
  baseId: string,
  title: string,
  body: Omit<ReviewRule, "ruleId" | "title" | "paper" | "source">,
): ReviewRule[] {
  return [
    {
      ruleId: `${baseId}.counterparty`,
      title: `${title}（对方纸）`,
      paper: "counterparty",
      source: `${SRC}-${baseId}`,
      ...body,
    },
    {
      ruleId: `${baseId}.own`,
      title: `${title}（己方纸）`,
      paper: "own",
      source: `${SRC}-${baseId}`,
      ...body,
      // Own paper: any deviation from house template needs explanation.
      guidance: [body.guidance ?? "", "己方纸：偏离我方模板即需说明；口径从严。"]
        .filter(Boolean)
        .join(" "),
    },
  ];
}

/** 12 rules: 6 baseline items × own/counterparty. */
export const CN_SALES_PLAYBOOK_ID = "cn-sales-v0";

export const CN_SALES_RULES: ReviewRule[] = [
  ...pair("liability.cap", "责任上限与责任排除对等性", {
    standard: "双方责任上限与排除对等，或对我方更有利",
    acceptable: ["双方同等封顶且排除范围对称", "仅轻微数字差异且有商业交换"],
    unacceptable: ["一方无限责任而另一方封顶", "单方免除故意或重大过失责任"],
    guidance: "对方纸以「能否接受」为主；无限责任不对等即永不接受。",
    absentAllowed: false,
    escalateWhen: "行业监管要求强制责任形态，模型无法判断",
  }),
  ...pair("dispute.forum", "争议解决与管辖", {
    standard: "管辖法院为被告住所地或合同履行地，双方对等；或裁或诉二选一",
    acceptable: ["约定中立仲裁机构且地与履行地合理关联"],
    unacceptable: ["单方指定对方所在地法院", "或裁或诉并存"],
    guidance: "与履行地明显不符即归永不接受。",
    absentAllowed: false,
    escalateWhen: "管辖地与交易实质无任何关联且当事人特殊地位不清",
  }),
  ...pair("termination.symmetry", "解除与终止对等性", {
    standard: "双方解除/终止权对等或有合理补偿结构",
    acceptable: ["对方任意解除但附充分提前通知与补偿"],
    unacceptable: ["对方保留任意解除而我方无对等权利且无补偿"],
    guidance: "优先扫单方任意解除。",
    absentAllowed: true,
    escalateWhen: "行业惯例允许单方解除但补偿公式缺失",
  }),
  ...pair("ip.data", "知识产权与数据范围", {
    standard: "不构成权属转让或超范围授权；数据使用限于本合同目的",
    acceptable: ["有限许可、期限与地域明确、可撤销"],
    unacceptable: ["默示权属转让", "超合同目的的数据永久授权"],
    guidance: "权属转让与超范围授权为永不接受。",
    absentAllowed: true,
    escalateWhen: "开源组件或背景 IP 边界不清",
  }),
  ...pair("payment.acceptance", "付款与验收主导权", {
    standard: "验收标准客观或双方共同确认；付款与验收挂钩合理",
    acceptable: ["对方主导验收但有异议期与第三方鉴定"],
    unacceptable: ["验收由对方单方决定且无救济", "付款严重倒挂且无担保"],
    guidance: "对方纸重点看验收单方决定与付款倒挂。",
    absentAllowed: false,
    escalateWhen: "行业特殊验收惯例（如分阶段里程碑）需人工定档",
  }),
  ...pair("confidentiality.noncompete", "保密与竞业边界", {
    standard: "保密期限与范围限于必要；竞业有合理地域/时间/补偿",
    acceptable: ["保密略长于交易周期但范围限于商业秘密"],
    unacceptable: ["无限期全领域竞业且无补偿", "保密范围覆盖公知信息"],
    guidance: "期限、范围超出必要即抬档。",
    absentAllowed: true,
    escalateWhen: "关键岗位竞业与劳动法规冲突需人工",
  }),
];

export function loadCnSalesRules(): ReviewRule[] {
  return CN_SALES_RULES.map((r) => ({ ...r }));
}
