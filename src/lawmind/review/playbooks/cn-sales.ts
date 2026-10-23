/**
 * v0 rule set for Chinese sales / general commercial contracts.
 * Extracted from `skills/builtin/contract-playbook-review.md` 底线项 × 纸别.
 *
 * Every rule is expressed as atomic yes/no criteria. The model answers the
 * questions; `verdict.ts` decides the tier. Prose (`standard`, `guidance`) is
 * for the lawyer and never decides anything.
 *
 * Two rules are written deliberately narrowly because they were the unstable
 * ones in testing (ip.data 65%, confidentiality 80%):
 *   - `ip.data` separates "is there a transfer" (always askable) from
 *     "does a data-delivery contract limit use to the contract purpose"
 *     (only askable when data is actually delivered).
 *   - `confidentiality.noncompete` uses a countable boundary (3 years) instead
 *     of "reasonable", and splits "is there a non-compete" from "is it complete".
 */

import type { ReviewRule } from "../rules.js";

const SRC = "skills/builtin/contract-playbook-review.md#底线项";

type RuleBody = Omit<ReviewRule, "ruleId" | "title" | "paper" | "source" | "guidance"> & {
  guidance?: string;
};

function pair(baseId: string, title: string, body: RuleBody): ReviewRule[] {
  const ownCriteria = body.criteria.map((c) => ({ ...c, id: c.id }));
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
      criteria: ownCriteria,
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
    criteria: [
      {
        id: "uncapped",
        question: "是否有一方的赔偿责任不设金额上限？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "gross_negligence_exempt",
        question: "是否约定免除一方因故意或重大过失产生的责任？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "caps_unequal",
        question: "双方赔偿上限的金额是否不一致？",
        verdictIfMet: "acceptable_deviation",
      },
      {
        id: "caps_symmetric",
        question: "双方赔偿责任是否都设有金额上限且数额一致？",
        verdictIfMet: "compliant",
      },
      {
        id: "exclusions_symmetric",
        question: "双方排除赔偿的范围是否对称（不存在只免除一方的情形）？",
        verdictIfMet: "compliant",
      },
    ],
    guidance:
      "未额外约定保密/IP 例外不影响合规；只在可接受回退里提示补强。无限责任不对等即永不接受。",
    absentAllowed: false,
    escalateWhen: "行业监管要求强制责任形态，模型无法判断",
  }),
  ...pair("dispute.forum", "争议解决与管辖", {
    standard: "管辖法院为被告住所地或合同履行地，双方对等；或裁或诉二选一",
    criteria: [
      {
        id: "unilateral_forum",
        question: "是否只约定由一方所在地法院管辖，且该地与合同履行地无实际联系？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "litigation_and_arbitration",
        question: "是否同时约定诉讼与仲裁两种争议解决方式？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "single_mechanism",
        question: "是否只约定了一种争议解决方式（诉讼或仲裁，二者不并存）？",
        verdictIfMet: "compliant",
      },
      {
        id: "forum_nexus",
        question: "约定的管辖连接点是否与合同有实际联系（被告住所地、履行地或仲裁地）？",
        verdictIfMet: "compliant",
      },
    ],
    guidance: "约定被告住所地即属合规，不因未同时写入履行地而降档。与履行地明显不符即永不接受。",
    absentAllowed: false,
    escalateWhen: "管辖地与交易实质无任何关联且当事人特殊地位不清",
  }),
  ...pair("termination.symmetry", "解除与终止对等性", {
    standard: "双方解除/终止权对等或有合理补偿结构",
    criteria: [
      {
        id: "one_sided_termination",
        // Must include "no compensation": an asymmetric-but-compensated
        // termination right is a deviation, not a dealbreaker. Without this the
        // unacceptable rung swallows the acceptable one.
        question:
          "是否约定一方可随时任意解除、另一方没有对等的任意解除权，且解除方不承担任何补偿？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "compensation_direct_cost_only",
        question: "单方任意解除的补偿是否只覆盖已发生的直接成本、不包含合理利润？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "notice_threshold",
        question: "存在单方任意解除，但通知期不足三十日或未约定通知期？",
        verdictIfMet: "acceptable_deviation",
      },
      {
        id: "rights_symmetric",
        question: "双方的解除权是否对等（不存在只有一方享有任意解除权）？",
        verdictIfMet: "compliant",
      },
      {
        id: "breach_cure_period",
        question: "因根本违约解除是否须经催告或给予合理纠正期？",
        verdictIfMet: "compliant",
      },
    ],
    guidance: "补偿是否充分以是否覆盖直接成本与合理利润为准。未约定解除条款时按 absent 判定。",
    absentAllowed: true,
    escalateWhen: "行业惯例允许单方解除但补偿公式缺失",
  }),
  ...pair("ip.data", "知识产权与数据范围", {
    standard: "不构成权属转让或超范围授权；数据使用限于本合同目的",
    criteria: [
      {
        id: "ownership_transfer",
        question: "合同是否将一方的知识产权权属转让给另一方？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "perpetual_overbroad_license",
        question: "合同是否授予超出合同目的、无期限或永久性的知识产权或数据授权？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "data_purpose_missing",
        question: "本合同涉及数据交付，但未约定交付的数据仅用于履行本合同之目的？",
        verdictIfMet: "acceptable_deviation",
      },
      {
        id: "background_ip_reserved",
        question: "是否约定双方各自保留其背景知识产权？",
        verdictIfMet: "compliant",
      },
      {
        id: "no_transfer_declared",
        question: "合同是否明确声明不构成知识产权权属转让？",
        verdictIfMet: "compliant",
      },
    ],
    guidance:
      "只做货物买卖、不涉及数据交付的合同，`data_purpose_missing` 答 false 即可，不因此降档。权属转让与超范围授权为永不接受。",
    absentAllowed: true,
    escalateWhen: "开源组件或背景 IP 边界不清",
  }),
  ...pair("payment.acceptance", "付款与验收主导权", {
    standard: "验收标准客观或双方共同确认；付款与验收挂钩合理",
    criteria: [
      {
        id: "unilateral_acceptance",
        question: "验收是否由对方单方决定，且我方没有异议或救济机制？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "prepay_without_security",
        question: "是否约定验收前全额付款且没有任何担保？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "joint_acceptance",
        question: "验收是否由双方共同确认，或标准客观可核（如国家标准、交货单）？",
        verdictIfMet: "compliant",
      },
      {
        id: "payment_tied_to_acceptance",
        question: "付款是否与验收挂钩（而非验收前全额支付）？",
        verdictIfMet: "compliant",
      },
    ],
    guidance: "双方共同验收即属合规；异议期、第三方鉴定属于补强建议，不因此把合规降档。",
    absentAllowed: false,
    escalateWhen: "行业特殊验收惯例（如分阶段里程碑）需人工定档",
  }),
  ...pair("confidentiality.noncompete", "保密与竞业边界", {
    standard:
      "保密期限与范围限于必要；如设竞业限制，须有合理地域、时间与补偿；不设竞业限制不构成缺陷",
    criteria: [
      {
        id: "unbounded_noncompete",
        question: "是否约定无期限的竞业限制，且不支付任何补偿？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "perpetual_confidentiality",
        question: "保密义务是否无期限（永久保密）？",
        verdictIfMet: "unacceptable",
      },
      {
        id: "term_over_three_years",
        question: "保密期限是否超过三年？",
        verdictIfMet: "acceptable_deviation",
      },
      {
        id: "noncompete_incomplete",
        question: "是否设有竞业限制，但地域、期限、补偿三项中有一项完全未约定？",
        verdictIfMet: "acceptable_deviation",
      },
      {
        id: "scope_confined",
        // Atomic by design: "limited to trade secrets" already excludes public
        // information, because that is what the term means. Demanding a
        // separate "excludes public info" clause made one question carry two
        // conditions — it could not be answered yes/no without ambiguity.
        question: "保密范围是否限定为商业秘密？",
        verdictIfMet: "compliant",
      },
      {
        id: "term_bounded",
        question: "保密期限是否明确且不超过三年？",
        verdictIfMet: "compliant",
      },
    ],
    guidance: "完全未设竞业限制不构成缺陷。期限超过三年即从 compliant 落到 acceptable_deviation。",
    absentAllowed: true,
    escalateWhen: "关键岗位竞业与劳动法规冲突需人工",
  }),
];

export function loadCnSalesRules(): ReviewRule[] {
  return CN_SALES_RULES.map((r) => ({
    ...r,
    criteria: r.criteria.map((c) => ({ ...c })),
  }));
}
