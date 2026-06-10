import {
  resolveWorkflowTemplateKind,
  workflowTemplateKindUiLabel,
  type WorkflowTemplateKind,
} from "../../../../src/lawmind/agent/collaboration/workspace-workflow-template-kind.ts";
import type { WorkflowTemplateItem } from "./LawmindWorkflowLibrary";

export function isOfficeWorkflowTemplate(template: WorkflowTemplateItem): boolean {
  return resolveWorkflowTemplateKind(template) === "office";
}

export function workflowTemplateKindLabel(template: WorkflowTemplateItem): ReturnType<
  typeof workflowTemplateKindUiLabel
> {
  return workflowTemplateKindUiLabel(resolveWorkflowTemplateKind(template));
}

export function sortWorkflowTemplatesForLawyer(
  templates: WorkflowTemplateItem[],
  opts: { preferOffice?: boolean } = {},
): WorkflowTemplateItem[] {
  return [...templates].toSorted((a, b) => {
    const aOffice = resolveWorkflowTemplateKind(a) === "office";
    const bOffice = resolveWorkflowTemplateKind(b) === "office";
    if (opts.preferOffice && aOffice !== bOffice) {
      return aOffice ? -1 : 1;
    }
    if (!opts.preferOffice && aOffice !== bOffice) {
      return aOffice ? 1 : -1;
    }
    const riskRank = (risk?: string) => (risk === "high" ? 2 : risk === "medium" ? 1 : 0);
    return riskRank(a.riskLevel) - riskRank(b.riskLevel) || a.name.localeCompare(b.name);
  });
}

export type { WorkflowTemplateKind };
