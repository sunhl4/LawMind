import { describe, expect, it } from "vitest";
import { citationModeBlocksRender, resolveCitationMode } from "./citation-mode.js";

describe("citation-mode", () => {
  it("defaults solo to assisted", () => {
    expect(resolveCitationMode({}, "solo", "")).toBe("assisted");
  });

  it("defaults private_deploy to grounded", () => {
    expect(resolveCitationMode({}, "private_deploy", "")).toBe("grounded");
  });

  it("grounded blocks when no research snapshot", () => {
    expect(
      citationModeBlocksRender("grounded", { checked: false, reason: "no_research_snapshot" }),
    ).toBe(true);
    expect(
      citationModeBlocksRender("assisted", { checked: false, reason: "no_research_snapshot" }),
    ).toBe(false);
  });

  it("grounded blocks unanchored sections", () => {
    expect(
      citationModeBlocksRender("grounded", {
        checked: true,
        ok: true,
        missingSourceIds: [],
        sectionsWithIssues: [],
        unanchoredSections: [{ heading: "一", reason: "section_lacks_citations" }],
      }),
    ).toBe(true);
  });
});
