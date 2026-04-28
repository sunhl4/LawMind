import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listWorkspaceWorkflowTemplates,
  readWorkspaceWorkflowTemplate,
  instantiateCollaborationWorkflowFromTemplate,
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
        steps: [{ stepId: "a", assignee: "asst1", task: "Hello {{matterId}}", dependsOn: [] }],
      }),
      "utf8",
    );

    const list = listWorkspaceWorkflowTemplates(root);
    expect(list).toEqual([{ id: "demo", name: "Demo flow", description: "test", stepCount: 1 }]);

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
