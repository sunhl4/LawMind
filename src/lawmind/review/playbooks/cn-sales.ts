/**
 * v0 rule set for Chinese sales / general commercial contracts.
 * Extracted from `skills/builtin/contract-playbook-review.md` 底线项 × 纸别.
 *
 * `compliantWhen` is the sufficient-condition list: meeting every item makes
 * the clause compliant. Extra protections the rule does not ask for must not
 * downgrade it — without that boundary, verdicts drift to acceptable_deviation.
 */

import type { ReviewRule } from "../rules.js";

const SRC = "skills/builtin/contract-playbook-review.md#底线项";

function pair(
  baseId: string,
  title: string,
  body: Omit<ReviewRule, "ruleId" | "title" | "paper" | "source" | "guidance"> & {
    guidance?: string;
  },
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
    compliantWhen: [
      "双方赔偿上限对等（或我方上限更低）",
      "排除范围对称，不存在一方无限责任",
      "未出现单方免除故意或重大过失责任",
    ],
    acceptable: ["双方同等封顶且排除范围对称", "仅轻微数字差异且有商业交换"],
    unacceptable: ["一方无限责任而另一方封顶", "单方免除故意或重大过失责任"],
    guidance:
      "对方纸以「能否接受」为主；无限责任不对等即永不接受。未额外约定保密/IP 例外不影响「合规」，只在可接受回退里提示补强。",
    absentAllowed: false,
    escalateWhen: "行业监管要求强制责任形态，模型无法判断",
  }),
  ...pair("dispute.forum", "争议解决与管辖", {
    standard: "管辖法院为被告住所地或合同履行地，双方对等；或裁或诉二选一",
    compliantWhen: [
      "只有一个争议解决方式（诉讼或仲裁，不并存）",
      "管辖连接点与合同有实际联系（被告住所地或履行地等）",
      "未单方指定仅对一方有利的法院",
    ],
    acceptable: ["约定中立仲裁机构且地与履行地合理关联"],
    unacceptable: ["单方指定对方所在地法院", "或裁或诉并存"],
    guidance: "与履行地明显不符即归永不接受。约定被告住所地即属合规，不因未同时写入履行地而降档。",
    absentAllowed: false,
    escalateWhen: "管辖地与交易实质无任何关联且当事人特殊地位不清",
  }),
  ...pair("termination.symmetry", "解除与终止对等性", {
    standard: "双方解除/终止权对等或有合理补偿结构",
    compliantWhen: [
      "解除权对等，或单方解除附提前通知与补偿",
      "不存在一方任意解除而另一方无对等权利",
      "根本违约解除需经催告或合理期限",
    ],
    acceptable: ["对方任意解除，但附不少于三十日提前通知，且补偿覆盖已发生直接成本与合理利润"],
    unacceptable: [
      "对方保留任意解除而我方无对等权利且无补偿",
      "单方任意解除仅补偿直接成本、不含合理利润",
    ],
    guidance:
      "优先扫单方任意解除。补偿是否充分以「覆盖直接成本与合理利润」为准；只补直接成本视为不可接受。未约定解除条款时按 absent 判定，不要推断为 needs_human。",
    absentAllowed: true,
    escalateWhen: "行业惯例允许单方解除但补偿公式缺失",
  }),
  ...pair("ip.data", "知识产权与数据范围", {
    standard: "不构成权属转让或超范围授权；数据使用限于本合同目的",
    compliantWhen: [
      "背景知识产权各自保留",
      "不存在明示或默示的权属转让",
      "不存在超合同目的的永久授权",
      "数据使用限于履行本合同之目的（买卖合同未涉及数据交付的，视为满足）",
    ],
    acceptable: ["有限许可、期限与地域明确、可撤销"],
    unacceptable: ["默示权属转让", "超合同目的的数据永久授权"],
    guidance:
      "只做货物买卖、不涉及数据交付的合同，不因缺数据条款而降档。权属转让与超范围授权为永不接受。",
    absentAllowed: true,
    escalateWhen: "开源组件或背景 IP 边界不清",
  }),
  ...pair("payment.acceptance", "付款与验收主导权", {
    standard: "验收标准客观或双方共同确认；付款与验收挂钩合理",
    compliantWhen: [
      "验收由双方共同确认，或标准客观可核",
      "付款与验收挂钩，不存在验收前全额支付且无担保",
      "不存在验收由对方单方决定且无救济",
    ],
    acceptable: ["对方主导验收但有异议期与第三方鉴定"],
    unacceptable: ["验收由对方单方决定且无救济", "付款严重倒挂且无担保"],
    guidance:
      "双方共同验收即属合规；异议期、第三方鉴定属于「可接受回退」里的补强建议，不因此把合规降档。",
    absentAllowed: false,
    escalateWhen: "行业特殊验收惯例（如分阶段里程碑）需人工定档",
  }),
  ...pair("confidentiality.noncompete", "保密与竞业边界", {
    standard:
      "保密期限与范围限于必要；如设竞业限制，须有合理地域、时间与补偿；不设竞业限制不构成缺陷",
    compliantWhen: [
      "保密范围限于商业秘密，不覆盖已公开信息",
      "保密期限确定，且不超过三年或与交易周期相匹配",
      "未设竞业限制，或所设竞业有地域、期限与补偿",
    ],
    acceptable: ["保密期限长于三年但范围仍限于商业秘密", "不设竞业限制（对接收方更有利）"],
    unacceptable: ["无限期全领域竞业且无补偿", "保密范围覆盖公知信息"],
    guidance:
      "期限、范围超出必要即抬档：保密期超过三年即从 compliant 落到 acceptable_deviation。设了竞业却缺地域或补偿的，也属可接受回退；完全未设竞业仍算合规。",
    absentAllowed: true,
    escalateWhen: "关键岗位竞业与劳动法规冲突需人工",
  }),
];

export function loadCnSalesRules(): ReviewRule[] {
  return CN_SALES_RULES.map((r) => ({ ...r }));
}
