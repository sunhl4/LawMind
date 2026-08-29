import { describe, expect, it } from "vitest";
import type { ArtifactDraft, ResearchBundle } from "../types.js";
import { validateDraftCitationsAgainstBundle } from "./citation-integrity.js";

function minimalBundle(overrides: Partial<ResearchBundle> = {}): ResearchBundle {
  return {
    taskId: "t1",
    query: "q",
    sources: [],
    claims: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function minimalDraft(sections: ArtifactDraft["sections"]): ArtifactDraft {
  return {
    taskId: "t1",
    title: "Test",
    output: "markdown",
    templateId: "default",
    summary: "s",
    sections,
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}

describe("validateDraftCitationsAgainstBundle", () => {
  it("ok when no citations on short body", () => {
    const b = minimalBundle({ sources: [{ id: "s1", title: "a", kind: "web" }] });
    const d = minimalDraft([{ heading: "H", body: "x" }]);
    const r = validateDraftCitationsAgainstBundle(d, b);
    expect(r.ok).toBe(true);
    expect(r.missingSourceIds).toEqual([]);
    expect(r.unanchoredSections).toEqual([]);
  });

  it("ok when all citation ids exist", () => {
    const b = minimalBundle({
      sources: [
        { id: "s1", title: "a", kind: "web" },
        { id: "s2", title: "b", kind: "statute" },
      ],
    });
    const d = minimalDraft([{ heading: "H", body: "x", citations: ["s2", "s1"] }]);
    const r = validateDraftCitationsAgainstBundle(d, b);
    expect(r.ok).toBe(true);
    expect(r.unanchoredSections).toEqual([]);
  });

  it("flags missing ids", () => {
    const b = minimalBundle({ sources: [{ id: "s1", title: "a", kind: "web" }] });
    const d = minimalDraft([
      { heading: "A", body: "x", citations: ["s1", "ghost"] },
      { heading: "B", body: "y", citations: ["ghost"] },
    ]);
    const r = validateDraftCitationsAgainstBundle(d, b);
    expect(r.ok).toBe(false);
    expect(r.missingSourceIds).toEqual(["ghost"]);
    expect(r.sectionsWithIssues).toHaveLength(2);
  });

  it("warns unanchored long sections when bundle has sources (ok still true)", () => {
    const b = minimalBundle({ sources: [{ id: "s1", title: "a", kind: "web" }] });
    const longBody = "甲".repeat(81);
    const d = minimalDraft([
      { heading: "结论", body: longBody },
      { heading: "短段", body: "短" },
      { heading: "已引用", body: longBody, citations: ["s1"] },
    ]);
    const r = validateDraftCitationsAgainstBundle(d, b);
    expect(r.ok).toBe(true);
    expect(r.missingSourceIds).toEqual([]);
    expect(r.unanchoredSections).toEqual([{ heading: "结论", reason: "section_lacks_citations" }]);
  });

  it("does not flag unanchored when bundle has no sources", () => {
    const b = minimalBundle({ sources: [] });
    const d = minimalDraft([{ heading: "H", body: "甲".repeat(81) }]);
    const r = validateDraftCitationsAgainstBundle(d, b);
    expect(r.ok).toBe(true);
    expect(r.unanchoredSections).toEqual([]);
  });
});
