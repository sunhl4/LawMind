/**
 * Browser-safe workflow template kind helpers (no node:fs / node:crypto).
 */

/** Lawyer-facing template category for UI sorting and labels. */
export type WorkflowTemplateKind = "office" | "matter";

const OFFICE_KEYWORDS = [
  "ppt",
  "presentation",
  "培训",
  "讲稿",
  "讲义",
  "汇报",
  "报告",
  "memo",
  "备忘录",
  "research",
  "研究",
  "材料",
  "文稿",
  "分享",
];

const CASE_KEYWORDS = [
  "案件",
  "合同",
  "律师函",
  "审查",
  "证据",
  "尽调",
  "续签",
  "matter",
  "contract",
  "demand",
  "evidence",
];

export type WorkflowTemplateKindInput = {
  kind?: WorkflowTemplateKind;
  id: string;
  name: string;
  description: string;
  deliverableType?: string;
};

export function resolveWorkflowTemplateKind(
  template: WorkflowTemplateKindInput,
): WorkflowTemplateKind {
  if (template.kind === "office" || template.kind === "matter") {
    return template.kind;
  }
  const text =
    `${template.id} ${template.name} ${template.description} ${template.deliverableType ?? ""}`.toLowerCase();
  if (OFFICE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return "office";
  }
  if (CASE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return "matter";
  }
  return "office";
}

export function workflowTemplateKindUiLabel(
  kind: WorkflowTemplateKind,
): "写文稿/做材料" | "案件工作" {
  return kind === "office" ? "写文稿/做材料" : "案件工作";
}
