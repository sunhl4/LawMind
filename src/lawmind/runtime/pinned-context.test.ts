import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePinnedContextSummary } from "./pinned-context.js";

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
});
