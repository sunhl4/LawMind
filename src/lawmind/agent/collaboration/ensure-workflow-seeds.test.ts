import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureBuiltinWorkflowSeeds } from "./ensure-workflow-seeds.js";
import { listWorkspaceWorkflowTemplates } from "./workspace-workflow-templates.js";

describe("ensureBuiltinWorkflowSeeds", () => {
  it("creates missing builtin templates without overwriting", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-wf-seed-"));
    const first = ensureBuiltinWorkflowSeeds(ws);
    expect(first.created.length).toBeGreaterThan(5);
    expect(listWorkspaceWorkflowTemplates(ws).some((t) => t.id === "nda-triage")).toBe(true);

    const second = ensureBuiltinWorkflowSeeds(ws);
    expect(second.created).toHaveLength(0);
    expect(second.upgraded).toHaveLength(0);
    expect(second.skipped.length).toBe(first.created.length);
  });

  it("upgrades legacy single-step contract-review seed", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-wf-up-"));
    const dir = path.join(ws, "lawmind", "workflows");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "contract-review.json"),
      JSON.stringify({
        id: "contract-review",
        name: "合同审查意见",
        steps: [{ stepId: "review", assignee: "contract_reviewer", task: "x", dependsOn: [] }],
      }),
      "utf8",
    );
    const r = ensureBuiltinWorkflowSeeds(ws);
    expect(r.upgraded).toContain("contract-review");
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "contract-review.json"), "utf8")) as {
      steps: Array<{ assigneeRoleId?: string }>;
    };
    expect(raw.steps.length).toBeGreaterThanOrEqual(2);
    expect(raw.steps.some((s) => s.assigneeRoleId === "contract_review")).toBe(true);
  });
});
