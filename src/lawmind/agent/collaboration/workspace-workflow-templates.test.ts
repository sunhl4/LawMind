import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listWorkspaceWorkflowTemplates,
  readWorkspaceWorkflowTemplate,
  instantiateCollaborationWorkflowFromTemplate,
  resolveWorkflowTemplateKind,
  workflowTemplateKindUiLabel,
} from "./workspace-workflow-templates.js";

describe("workspace-workflow-templates", () => {
  it("lists and reads templates under workspace/lawmind/workflows", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-wf-"));
    const wfDir = path.join(root, "lawmind", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "demo.json"),
      JSON.stringify({
        id: "demo",
        name: "Demo flow",
        description: "test",
        kind: "office",
        steps: [{ stepId: "a", assignee: "asst1", task: "Hello {{matterId}}", dependsOn: [] }],
      }),
      "utf8",
    );

    const list = listWorkspaceWorkflowTemplates(root);
    expect(list).toEqual([
      {
        id: "demo",
        name: "Demo flow",
        description: "test",
        stepCount: 1,
        practiceArea: undefined,
        deliverableType: undefined,
        riskLevel: undefined,
        audience: undefined,
        starterPrompt: undefined,
        acceptancePackRequired: false,
        requiredSources: undefined,
        schedulable: false,
        triggerPaths: undefined,
        kind: "office",
      },
    ]);

    const t = readWorkspaceWorkflowTemplate(root, "demo");
    expect(t?.steps[0]?.task).toBe("Hello {{matterId}}");

    const w = instantiateCollaborationWorkflowFromTemplate(t!, {
      matterId: "m-1",
      createdBy: "boss",
    });
    expect(w.steps[0].task).toBe("Hello m-1");
    expect(w.createdBy).toBe("boss");
  });

  it("rejects path traversal in template id", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-wf2-"));
    expect(readWorkspaceWorkflowTemplate(root, "../evil")).toBeUndefined();
  });
});

describe("resolveWorkflowTemplateKind", () => {
  it("prefers explicit kind when set", () => {
    expect(
      resolveWorkflowTemplateKind({
        id: "contract-review",
        name: "合同审查意见",
        description: "审查主合同",
        kind: "office",
      }),
    ).toBe("office");
    expect(
      resolveWorkflowTemplateKind({
        id: "training-ppt",
        name: "培训 PPT",
        description: "培训课件",
        kind: "matter",
      }),
    ).toBe("matter");
  });

  it("classifies office templates without explicit kind", () => {
    expect(
      resolveWorkflowTemplateKind({
        id: "training-ppt",
        name: "培训 PPT",
        description: "把一个主题整理成培训课件",
      }),
    ).toBe("office");
  });

  it("classifies matter templates without explicit kind", () => {
    expect(
      resolveWorkflowTemplateKind({
        id: "contract-review",
        name: "合同审查意见",
        description: "生成带章节结构的合同审查意见",
      }),
    ).toBe("matter");
  });
});

describe("workflowTemplateKindUiLabel", () => {
  it("maps kind to lawyer-facing labels", () => {
    expect(workflowTemplateKindUiLabel("office")).toBe("写文稿/做材料");
    expect(workflowTemplateKindUiLabel("matter")).toBe("案件工作");
  });
});
