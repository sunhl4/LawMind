import { describe, expect, it } from "vitest";
import {
  isOfficeWorkflowTemplate,
  sortWorkflowTemplatesForLawyer,
  workflowTemplateKindLabel,
  workflowTemplateSearchHaystack,
} from "./lawmind-workflow-display";
import type { WorkflowTemplateItem } from "./lawmind-workflow-types";

const officeTemplate: WorkflowTemplateItem = {
  id: "training-ppt",
  name: "培训 PPT",
  description: "培训课件",
  stepCount: 1,
  kind: "office",
  deliverableType: "ppt.training",
};

const matterTemplate: WorkflowTemplateItem = {
  id: "contract-review",
  name: "合同审查意见",
  description: "审查主合同",
  stepCount: 1,
  kind: "matter",
};

describe("lawmind-workflow-display", () => {
  it("labels templates from explicit kind", () => {
    expect(workflowTemplateKindLabel(officeTemplate)).toBe("写文稿/做材料");
    expect(workflowTemplateKindLabel(matterTemplate)).toBe("案件工作");
    expect(isOfficeWorkflowTemplate(officeTemplate)).toBe(true);
    expect(isOfficeWorkflowTemplate(matterTemplate)).toBe(false);
  });

  it("search haystack uses lawyer deliverable labels, not raw codes", () => {
    const hay = workflowTemplateSearchHaystack(officeTemplate);
    expect(hay).toContain("培训课件");
    expect(hay).not.toContain("ppt.training");
  });

  it("sorts office templates first when preferOffice is true", () => {
    const sorted = sortWorkflowTemplatesForLawyer([matterTemplate, officeTemplate], {
      preferOffice: true,
    });
    expect(sorted.map((t) => t.id)).toEqual(["training-ppt", "contract-review"]);
  });

  it("sorts matter templates first when preferOffice is false", () => {
    const sorted = sortWorkflowTemplatesForLawyer([officeTemplate, matterTemplate], {
      preferOffice: false,
    });
    expect(sorted.map((t) => t.id)).toEqual(["contract-review", "training-ppt"]);
  });
});
