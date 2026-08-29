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

  it("upgrades legacy 5-step mail-contract-redline to short path", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-wf-mail-"));
    const dir = path.join(ws, "lawmind", "workflows");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "mail-contract-redline.json"),
      JSON.stringify({
        id: "mail-contract-redline",
        name: "邮件合同审阅改稿",
        steps: [
          { stepId: "ingest", assignee: "contract_review", task: "a", dependsOn: [] },
          {
            stepId: "surgical_edit",
            assignee: "contract_review",
            task: "b",
            dependsOn: ["ingest"],
          },
          {
            stepId: "opinion",
            assignee: "contract_review",
            task: "c",
            dependsOn: ["surgical_edit"],
          },
          {
            stepId: "export_tracked",
            assignee: "contract_review",
            task: "d",
            dependsOn: ["surgical_edit"],
          },
          {
            stepId: "handoff",
            assignee: "contract_review",
            task: "e",
            dependsOn: ["export_tracked", "opinion"],
          },
        ],
      }),
      "utf8",
    );
    const r = ensureBuiltinWorkflowSeeds(ws);
    expect(r.upgraded).toContain("mail-contract-redline");
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, "mail-contract-redline.json"), "utf8"),
    ) as { steps: Array<{ stepId: string; task?: string }> };
    expect(raw.steps.map((s) => s.stepId)).toEqual(["redline", "handoff"]);
    expect(raw.steps.find((s) => s.stepId === "redline")?.task ?? "").toContain("redlinePending");
  });

  it("upgrades short-path mail-contract-redline missing hunk-gate wording", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-wf-mail-hunk-"));
    const dir = path.join(ws, "lawmind", "workflows");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "mail-contract-redline.json"),
      JSON.stringify({
        id: "mail-contract-redline",
        name: "邮件合同审阅改稿",
        steps: [
          {
            stepId: "redline",
            assignee: "contract_review",
            task: "{{instruction}}\n旧短路径：直接 render_tracked_draft",
            dependsOn: [],
          },
          {
            stepId: "handoff",
            assignee: "contract_review",
            task: "prepare_outbound_mail",
            dependsOn: ["redline"],
          },
        ],
      }),
      "utf8",
    );
    const r = ensureBuiltinWorkflowSeeds(ws);
    expect(r.upgraded).toContain("mail-contract-redline");
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, "mail-contract-redline.json"), "utf8"),
    ) as { steps: Array<{ stepId: string; task?: string }> };
    const redlineTask = raw.steps.find((s) => s.stepId === "redline")?.task ?? "";
    expect(redlineTask).toContain("redlinePending");
    expect(redlineTask).toContain("空修订");
    expect(redlineTask).toContain("apply_surgical_edits");
    expect(redlineTask).toContain("craft_check");
    expect(redlineTask).toContain("能改几个字就只改几个字");
    expect(redlineTask).toContain("硬门禁");
    expect(redlineTask).toContain("条数不限");
    expect(redlineTask).not.toContain("最多 24");
    expect(redlineTask).not.toContain("应改尽改");
    expect(redlineTask).not.toContain("2–3 处");
  });
});
