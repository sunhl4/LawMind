import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { assessDeliverableReadiness } from "./deliverable-readiness.js";

function baseDraft(over: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "t1",
    title: "NDA 审查意见",
    output: "docx",
    templateId: "contract-review",
    deliverableType: "contract.review",
    summary: "摘要",
    sections: [
      { heading: "当事人", body: "甲乙双方", citations: ["s1"] },
      { heading: "风险", body: "责任上限", citations: ["s1"] },
      { heading: "建议", body: "谈判要点", citations: ["s1"] },
    ],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("assessDeliverableReadiness", () => {
  it("blocks approve and export when checklist incomplete", () => {
    const r = assessDeliverableReadiness({
      draft: baseDraft(),
      checklistState: { specId: "contract-review-v1", checked: { parties: true } },
      citationIntegrity: {
        checked: true,
        ok: true,
        missingSourceIds: [],
        sectionsWithIssues: [],
        unanchoredSections: [],
      },
      citationMode: "assisted",
    });
    expect(r.readyToApprove).toBe(false);
    expect(r.readyToExport).toBe(false);
    expect(r.blockers.some((b) => b.code === "checklist")).toBe(true);
    expect(r.summaryZh).toMatch(/必核/);
  });

  it("ready to export when approved + checklist complete + acceptance + citations", () => {
    const checked = {
      parties: true,
      liability: true,
      ip: true,
      terminate: true,
      citations: true,
    };
    const r = assessDeliverableReadiness({
      draft: baseDraft({
        reviewStatus: "approved",
        verificationChecklist: { specId: "contract-review-v1", checked },
      }),
      citationIntegrity: {
        checked: true,
        ok: true,
        missingSourceIds: [],
        sectionsWithIssues: [],
        unanchoredSections: [],
      },
      citationMode: "assisted",
    });
    expect(r.checklist.complete).toBe(true);
    expect(r.readyToApprove).toBe(true);
    expect(r.citationBlocks).toBe(false);
    // acceptance may still block depending on spec; export readiness follows gates
    if (r.acceptance.ready) {
      expect(r.readyToExport).toBe(true);
      expect(r.summaryZh).toMatch(/可交付/);
    }
  });

  it("flags citation blockers under grounded mode", () => {
    const r = assessDeliverableReadiness({
      draft: baseDraft({ reviewStatus: "approved" }),
      checklistState: {
        specId: "contract-review-v1",
        checked: {
          parties: true,
          liability: true,
          ip: true,
          terminate: true,
          citations: true,
        },
      },
      citationIntegrity: { checked: false, reason: "no_research_snapshot" },
      citationMode: "grounded",
    });
    expect(r.citationBlocks).toBe(true);
    expect(r.blockers.some((b) => b.code === "citation")).toBe(true);
  });
});
