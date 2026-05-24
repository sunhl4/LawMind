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
    expect(second.skipped.length).toBe(first.created.length);
  });
});
