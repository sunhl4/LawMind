import type {
  WorkspaceWorkflowTemplateFile,
  WorkspaceWorkflowTemplateListItem,
} from "./workspace-workflow-templates.js";

export type WorkflowPlaybookSummary = {
  id: string;
  name: string;
  practiceArea?: string;
  deliverableType?: string;
  riskLevel: "low" | "medium" | "high" | "unspecified";
  stepCount: number;
  requiredSources: string[];
  approvalPoints: string[];
  acceptancePackRequired: boolean;
  suggestedWhen: string[];
};

type WorkflowLike = WorkspaceWorkflowTemplateFile | WorkspaceWorkflowTemplateListItem;

export function buildWorkflowPlaybookSummary(template: WorkflowLike): WorkflowPlaybookSummary {
  const requiredSources = template.requiredSources ?? [];
  const approvalPoints =
    "steps" in template
      ? template.steps
          .filter((step) => step.reviewBy || step.autoApprove === false)
          .map((step) => step.reviewBy ?? step.stepId)
      : [];
  return {
    id: template.id,
    name: template.name,
    practiceArea: template.practiceArea,
    deliverableType: template.deliverableType,
    riskLevel: template.riskLevel ?? "unspecified",
    stepCount: "steps" in template ? template.steps.length : template.stepCount,
    requiredSources,
    approvalPoints,
    acceptancePackRequired: template.acceptancePackRequired === true,
    suggestedWhen: template.triggerPaths ?? [],
  };
}

export function buildWorkflowPlaybookMarkdown(template: WorkflowLike): string {
  const summary = buildWorkflowPlaybookSummary(template);
  const lines = [
    `# ${summary.name}`,
    "",
    `- Workflow ID: \`${summary.id}\``,
    `- Practice area: ${summary.practiceArea ?? "unspecified"}`,
    `- Deliverable: ${summary.deliverableType ?? "unspecified"}`,
    `- Risk level: ${summary.riskLevel}`,
    `- Steps: ${summary.stepCount}`,
    `- Acceptance pack required: ${summary.acceptancePackRequired ? "yes" : "no"}`,
    "",
    "## Required Sources",
    ...(summary.requiredSources.length
      ? summary.requiredSources.map((item) => `- ${item}`)
      : ["- none"]),
    "",
    "## Approval Points",
    ...(summary.approvalPoints.length
      ? summary.approvalPoints.map((item) => `- ${item}`)
      : ["- none"]),
  ];
  if (summary.suggestedWhen.length > 0) {
    lines.push("", "## Suggested When", ...summary.suggestedWhen.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}
