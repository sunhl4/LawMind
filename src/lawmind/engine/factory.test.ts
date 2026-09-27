import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearExtraDeliverableSpecs, listExtraDeliverableSpecs } from "../deliverables/registry.js";
import { createLawMindEngine } from "./factory.js";

describe("engine/factory customDeliverableSpec gate", () => {
  let workspaceDir: string;

  afterEach(() => {
    clearExtraDeliverableSpecs();
    if (workspaceDir) {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  function writeCustomSpec(ws: string): void {
    const dir = path.join(ws, "lawmind", "deliverables");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "employment.json"),
      JSON.stringify({
        type: "contract.employment",
        displayName: "劳动合同",
        description: "测试用",
        defaultTemplateId: "contract-employment-default",
        requiredSections: [{ headingKeywords: ["主体"], purpose: "合同双方", severity: "blocker" }],
      }),
      "utf8",
    );
  }

  it("loads workspace specs on Solo by default", () => {
    workspaceDir = mkdtempSync(path.join(tmpdir(), "lm-factory-solo-"));
    writeCustomSpec(workspaceDir);
    createLawMindEngine({ workspaceDir, adapters: [] });
    expect(listExtraDeliverableSpecs().map((s) => s.type)).toContain("contract.employment");
  });

  it("keeps workspace specs when policy.features tries to disable them", () => {
    workspaceDir = mkdtempSync(path.join(tmpdir(), "lm-factory-off-"));
    writeCustomSpec(workspaceDir);
    writeFileSync(
      path.join(workspaceDir, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "solo",
        features: { customDeliverableSpec: false },
      }),
      "utf8",
    );
    createLawMindEngine({ workspaceDir, adapters: [] });
    expect(listExtraDeliverableSpecs().map((s) => s.type)).toContain("contract.employment");
  });
});
