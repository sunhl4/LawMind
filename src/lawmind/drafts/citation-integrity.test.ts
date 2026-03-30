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
  it("ok when no citations", () => {
    const b = minimalBundle({ sources: [{ id: "s1", title: "a", kind: "web" }] });
    const d = minimalDraft([{ heading: "H", body: "x" }]);
    const r = validateDraftCitationsAgainstBundle(d, b);
    expect(r.ok).toBe(true);
    expect(r.missingSourceIds).toEqual([]);
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
});
