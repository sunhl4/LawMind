import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ArtifactDraft, ResearchBundle } from "../types.js";
import { resolveDraftCitationIntegrity } from "./citation-resolve.js";
import { persistResearchSnapshot } from "./research-snapshot.js";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-cr-"));
}

describe("resolveDraftCitationIntegrity", () => {
  it("returns unchecked when no snapshot", () => {
    const ws = tmpWs();
    const draft: ArtifactDraft = {
      taskId: "t1",
      title: "x",
      output: "docx",
      templateId: "word/default",
      summary: "s",
      sections: [{ heading: "H", body: "b", citations: ["ghost"] }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    const r = resolveDraftCitationIntegrity(ws, draft);
    expect(r.checked).toBe(false);
    if (!r.checked) {
      expect(r.reason).toBe("no_research_snapshot");
    }
  });

  it("validates when snapshot exists", () => {
    const ws = tmpWs();
    const bundle: ResearchBundle = {
      taskId: "t1",
      query: "q",
      sources: [{ id: "s1", title: "a", kind: "web" }],
      claims: [],
      riskFlags: [],
      missingItems: [],
      requiresReview: false,
      completedAt: new Date().toISOString(),
    };
    persistResearchSnapshot(ws, bundle);
    const draft: ArtifactDraft = {
      taskId: "t1",
      title: "x",
      output: "docx",
      templateId: "word/default",
      summary: "s",
      sections: [{ heading: "H", body: "b", citations: ["s1", "x"] }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    const r = resolveDraftCitationIntegrity(ws, draft);
    expect(r.checked).toBe(true);
    if (r.checked) {
      expect(r.ok).toBe(false);
      expect(r.missingSourceIds).toEqual(["x"]);
    }
  });
});
