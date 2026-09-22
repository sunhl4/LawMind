import { describe, expect, it } from "vitest";
import { buildWorkflowPlaybookMarkdown, buildWorkflowPlaybookSummary } from "./playbook-summary.js";
import type { WorkspaceWorkflowTemplateFile } from "./workspace-workflow-templates.js";

const template: WorkspaceWorkflowTemplateFile = {
  id: "contract-review",
  name: "合同审查",
  description: "审查合同并输出风险清单",
  practiceArea: "commercial",
  deliverableType: "contract-review",
  riskLevel: "high",
  acceptancePackRequired: true,
  requiredSources: ["contract.docx", "client-position.md"],
  triggerPaths: ["*.docx"],
  steps: [
    {
      stepId: "review",
      assignee: "contract_reviewer",
      task: "审查合同",
      dependsOn: [],
      reviewBy: "partner",
      autoApprove: false,
    },
  ],
};

describe("workflow playbook summary", () => {
  it("summarizes workflow requirements for the product UI", () => {
    const summary = buildWorkflowPlaybookSummary(template);
    expect(summary.riskLevel).toBe("high");
    expect(summary.requiredSources).toEqual(["contract.docx", "client-position.md"]);
    expect(summary.approvalPoints).toEqual(["partner"]);
    expect(summary.acceptancePackRequired).toBe(true);
  });

  it("renders lawyer-readable markdown", () => {
    const md = buildWorkflowPlaybookMarkdown(template);
    expect(md).toContain("Required Sources");
    expect(md).toContain("Approval Points");
  });
});
