/**
 * Practice-area personas (Claude for Legal / Suzie Law) — maps UI labels to assistant presets & workflows.
 */

export type PracticeAreaId =
  | "litigation"
  | "commercial"
  | "compliance"
  | "client"
  | "due_diligence"
  | "ip"
  | "tax";

export type PracticePersona = {
  id: PracticeAreaId;
  label: string;
  description: string;
  /** Assistant preset / Role id */
  presetKey: string;
  suggestedWorkflowIds: string[];
};

export const PRACTICE_PERSONAS: PracticePersona[] = [
  {
    id: "litigation",
    label: "诉讼与争议",
    description: "程序节点、请求权与对抗策略",
    presetKey: "general_litigation",
    suggestedWorkflowIds: ["demand-letter", "matter-chronology", "evidence-index"],
  },
  {
    id: "commercial",
    label: "商事合同",
    description: "合同审查、NDA 与商业条款",
    presetKey: "contract_review",
    suggestedWorkflowIds: [
      "contract-review",
      "nda-triage",
      "vendor-agreement-review",
      "renewal-monitor",
    ],
  },
  {
    id: "compliance",
    label: "合规研究",
    description: "规范层级与适用边界",
    presetKey: "compliance_research",
    suggestedWorkflowIds: ["compliance-research-memo", "office-research-report", "training-ppt"],
  },
  {
    id: "client",
    label: "客户沟通",
    description: "面向客户的备忘录与进展说明",
    presetKey: "client_memo",
    suggestedWorkflowIds: ["client-update-memo", "training-ppt"],
  },
  {
    id: "due_diligence",
    label: "尽职调查",
    description: "事实核对、证据索引与审查矩阵",
    presetKey: "due_diligence",
    suggestedWorkflowIds: ["due-diligence-review", "evidence-index", "contract-review"],
  },
  {
    id: "ip",
    label: "知识产权",
    description: "许可、侵权与权属条款（复用合同审查岗位）",
    presetKey: "contract_review",
    suggestedWorkflowIds: ["contract-review", "nda-triage"],
  },
  {
    id: "tax",
    label: "税务",
    description: "税务条款与合规备忘（复用合规研究岗位）",
    presetKey: "compliance_research",
    suggestedWorkflowIds: ["client-update-memo"],
  },
];

export const PRACTICE_AREA_LABELS: Record<string, string> = Object.fromEntries(
  PRACTICE_PERSONAS.map((p) => [p.id, p.label]),
);

export function practicePersonaByPresetKey(presetKey: string): PracticePersona | undefined {
  return PRACTICE_PERSONAS.find((p) => p.presetKey === presetKey);
}
