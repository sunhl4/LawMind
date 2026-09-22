import { describe, expect, it } from "vitest";
import {
  isAllowedAnalysisScriptRel,
  isProtectedAnalysisScriptRel,
  parseSkillAnalysisScriptRel,
} from "./analysis-script-path.js";

describe("analysis-script-path", () => {
  it("allows only leaf js under the two roots", () => {
    expect(isAllowedAnalysisScriptRel("lawmind/skills/demo/scripts/sum.js")).toBe(true);
    expect(isAllowedAnalysisScriptRel("artifacts/analysis-scripts/a.js")).toBe(true);
    expect(isAllowedAnalysisScriptRel("artifacts/analysis-scripts/nested/a.js")).toBe(false);
    expect(isAllowedAnalysisScriptRel("notes/sum.js")).toBe(false);
  });

  it("protects the whole script trees from write_document", () => {
    expect(isProtectedAnalysisScriptRel("artifacts/analysis-scripts/a.js")).toBe(true);
    expect(isProtectedAnalysisScriptRel("lawmind/skills/demo/scripts/note.md")).toBe(true);
    expect(isProtectedAnalysisScriptRel("artifacts/out.xlsx")).toBe(false);
  });

  it("parses skill id from the relative path", () => {
    expect(
      parseSkillAnalysisScriptRel("lawmind/skills/spreadsheet-analysis/scripts/sum.js"),
    ).toEqual({
      skillId: "spreadsheet-analysis",
      file: "sum",
    });
  });
});
