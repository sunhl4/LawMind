import type { WorkflowTemplateKind } from "../../../../src/lawmind/agent/collaboration/workspace-workflow-template-kind.ts";

/** Shared workflow template row used by compose gallery / display helpers. */
export type WorkflowTemplateItem = {
  id: string;
  name: string;
  namedAgent?: string;
  description: string;
  stepCount: number;
  practiceArea?: string;
  deliverableType?: string;
  riskLevel?: string;
  starterPrompt?: string;
  acceptancePackRequired?: boolean;
  requiredSources?: string[];
  schedulable?: boolean;
  kind?: WorkflowTemplateKind;
};
