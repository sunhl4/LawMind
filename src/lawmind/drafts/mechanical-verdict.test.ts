import { describe, expect, it } from "vitest";
import type { ValidateFileReferencesResult } from "./evidence-anchor.js";
import { evaluateMechanicalVerdict } from "./mechanical-verdict.js";

describe("evaluateMechanicalVerdict fileReferences", () => {
  it("blocks export when evidence-anchor status is not PASSED", () => {
    const failed: ValidateFileReferencesResult = {
      status: "FAILED",
      summary: { total: 1, passed: 0, failed: 1, incomplete: 0 },
      issues: [{ id: "r1", code: "sha_mismatch", reasonZh: "改过" }],
    };
    const incomplete: ValidateFileReferencesResult = {
      status: "INCOMPLETE",
      summary: { total: 1, passed: 0, failed: 0, incomplete: 1 },
      issues: [{ id: "r1", code: "unverifiable_locator", reasonZh: "PDF" }],
    };
    expect(
      evaluateMechanicalVerdict({
        citation: null,
        acceptanceReady: null,
        redlinePending: null,
        fileReferences: failed,
      }).blocks,
    ).toContain("file_references");
    expect(
      evaluateMechanicalVerdict({
        citation: null,
        acceptanceReady: null,
        redlinePending: null,
        fileReferences: incomplete,
      }).green,
    ).toBe(false);
  });

  it("stays green on PASSED", () => {
    const passed: ValidateFileReferencesResult = {
      status: "PASSED",
      summary: { total: 1, passed: 1, failed: 0, incomplete: 0 },
      issues: [],
    };
    const v = evaluateMechanicalVerdict({
      citation: null,
      acceptanceReady: true,
      redlinePending: null,
      fileReferences: passed,
    });
    expect(v.green).toBe(true);
    expect(v.blocks).toEqual([]);
  });
});
