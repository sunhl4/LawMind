import type { TriagePreviewInput, TriageResult, TriageTier } from "./types.js";

type Rule = {
  id: string;
  test: (text: string, hint?: string) => boolean;
  tier: TriageTier;
  reason: string;
  workflowId: string;
  workflowLabel: string;
  effort: TriageResult["estimatedEffort"];
  clarifications?: TriageResult["clarifications"];
};

const TIER_RANK: Record<TriageTier, number> = { green: 0, yellow: 1, red: 2 };

const TIER_LABEL: Record<TriageTier, string> = {
  green: "可直接执行",
  yellow: "需律师确认",
  red: "必须先澄清",
};

const RULES: Rule[] = [
  {
    id: "litigation-red",
    test: (t) =>
      /起诉|应诉|开庭|诉讼|仲裁|强制执行|保全|答辩状|代理词/.test(t) && !/咨询|了解一下/.test(t),
    tier: "red",
    reason: "涉及诉讼/仲裁程序材料，须先对齐争点、期限与当事人。",
    workflowId: "litigation-intake",
    workflowLabel: "诉讼材料分诊",
    effort: "high",
    clarifications: [
      { key: "parties", question: "各方当事人全称与诉讼地位？", required: true },
      { key: "deadline", question: "最近法定期限或开庭日？", required: true },
      { key: "claim", question: "核心诉讼请求或答辩要点？", required: true },
    ],
  },
  {
    id: "nda-yellow",
    test: (t, hint) =>
      hint === "contract.nda" || /\bNDA\b|保密协议|互惠保密|单向保密|non-?disclosure/i.test(t),
    tier: "yellow",
    reason: "保密协议常见单边义务与期限陷阱，建议确认立场后再审查。",
    workflowId: "nda-standard-review",
    workflowLabel: "NDA 标准审查",
    effort: "medium",
    clarifications: [
      { key: "stance", question: "我方是披露方、接收方还是双方互惠？", required: true },
      { key: "term", question: "期望保密义务期限？", required: false },
    ],
  },
  {
    id: "contract-review-yellow",
    test: (t, hint) =>
      (hint != null && hint.startsWith("contract")) ||
      /合同审查|审合同|条款审查|MSA|SOW|服务协议|采购合同/.test(t),
    tier: "yellow",
    reason: "合同审查建议走标准专案组剧本，确认风险偏好后执行。",
    workflowId: "cn-contract-review",
    workflowLabel: "中国合同审查（自研包）",
    effort: "medium",
    clarifications: [
      { key: "risk", question: "我方风险偏好（偏严 / 中性 / 促成交）？", required: false },
    ],
  },
  {
    id: "demand-letter-yellow",
    test: (t, hint) => hint === "letter.demand" || /律师函|催告|违约通知|demand letter/i.test(t),
    tier: "yellow",
    reason: "对外催告文书需核对事实与主张金额后再起草。",
    workflowId: "cn-labor-demand",
    workflowLabel: "催告/劳动催告（自研包）",
    effort: "medium",
    clarifications: [
      { key: "amount", question: "主张金额或履行内容？", required: true },
      { key: "facts", question: "关键违约事实要点？", required: true },
    ],
  },
  {
    id: "simple-green",
    test: (t) => t.trim().length > 0 && t.trim().length < 400 && !/诉讼|仲裁|起诉/.test(t),
    tier: "green",
    reason: "材料与指令较完整，可按默认剧本执行。",
    workflowId: "general-deliverable",
    workflowLabel: "通用文书交办",
    effort: "low",
  },
];

export function listTriageRuleIds(): string[] {
  return RULES.map((r) => r.id);
}

/** Pure rule engine — highest tier wins; first matching rule of that tier keeps clarifications. */
export function runTriageRules(input: TriagePreviewInput): TriageResult {
  const text = input.text.trim();
  if (!text) {
    return {
      tier: "red",
      tierLabel: TIER_LABEL.red,
      reasons: ["未提供任务描述或材料摘要，无法分诊。"],
      recommendedWorkflowId: "general-deliverable",
      recommendedWorkflowLabel: "通用文书交办",
      estimatedEffort: "low",
      clarifications: [{ key: "brief", question: "请简述任务目标与关键材料。", required: true }],
      matchedRuleIds: ["empty-input"],
    };
  }

  let bestTier: TriageTier = "green";
  const matched: Rule[] = [];
  for (const rule of RULES) {
    if (rule.test(text, input.deliverableTypeHint)) {
      matched.push(rule);
      if (TIER_RANK[rule.tier] > TIER_RANK[bestTier]) {
        bestTier = rule.tier;
      }
    }
  }

  const primary =
    matched.find((r) => r.tier === bestTier) ??
    ({
      id: "fallback-green",
      tier: "green" as const,
      reason: "未命中专项规则，按通用交办处理。",
      workflowId: "general-deliverable",
      workflowLabel: "通用文书交办",
      effort: "low" as const,
      clarifications: [],
      test: () => true,
    } satisfies Rule);

  const reasons = matched.length
    ? matched.filter((r) => r.tier === bestTier || matched.length <= 2).map((r) => r.reason)
    : [primary.reason];

  return {
    tier: bestTier,
    tierLabel: TIER_LABEL[bestTier],
    reasons: [...new Set(reasons)],
    recommendedWorkflowId: primary.workflowId,
    recommendedWorkflowLabel: primary.workflowLabel,
    estimatedEffort: primary.effort,
    clarifications: primary.clarifications ?? [],
    matchedRuleIds: matched.length ? matched.map((r) => r.id) : [primary.id],
  };
}
