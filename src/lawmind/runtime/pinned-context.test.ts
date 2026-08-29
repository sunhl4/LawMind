import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePinnedContextSummary, withContractPlaybookPin } from "./pinned-context.js";

describe("pinned-context", () => {
  it("builds markdown for theory and evidence pins", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pinned-"));
    const matterId = "matter-001";
    fs.mkdirSync(path.join(workspaceDir, "cases", matterId), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "cases", matterId, "MATTER_STRATEGY.md"),
      "# Strategy\n\nFocus on liability cap.",
      "utf8",
    );

    const summary = resolvePinnedContextSummary({
      workspaceDir,
      pins: [
        { pinKind: "theory", matterId },
        { pinKind: "evidence", matterId, relPath: "contracts/main.pdf" },
      ],
    });

    expect(summary.included).toBe(true);
    expect(summary.evidence).toContain("theory:cases/matter-001/MATTER_STRATEGY.md");
    expect(summary.evidence).toContain("evidence:cases/matter-001/contracts/main.pdf");
    expect(summary.markdownBlock).toContain("本案理论");
    expect(summary.markdownBlock).toContain("Focus on liability cap");

    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("auto-pins the clause playbook for contract work", () => {
    const pins = withContractPlaybookPin([], "请起草一份保密协议");
    expect(pins).toEqual([{ pinKind: "clause", scope: "full" }]);
    expect(withContractPlaybookPin(pins, "请起草一份保密协议")).toEqual(pins);
    expect(withContractPlaybookPin([], "查一下民法典相关法条")).toEqual([]);
  });

  it("does not auto-pin CLAUSE_PLAYBOOK on Word revision turns", () => {
    const pins = withContractPlaybookPin(
      [
        {
          pinKind: "file",
          root: "project",
          relPath: "设备采购合同.docx",
          kind: "file",
        },
      ],
      "改合同，代表甲方",
    );
    expect(pins.some((pin) => pin.pinKind === "clause")).toBe(false);
  });
});
