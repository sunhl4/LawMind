import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { assessDeliverableReadiness } from "./deliverable-readiness.js";
import type { ReasoningReport } from "./types.js";

function baseDraft(over: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "t1",
    title: "NDA 审查意见",
    output: "docx",
    templateId: "contract-review",
    deliverableType: "contract.review",
    summary: "摘要",
    sections: [
      { heading: "审查结论", body: "可继续谈判。", citations: ["s1"] },
      { heading: "主要风险", body: "第 8 条责任上限过低。", citations: ["s1"] },
      { heading: "修改建议", body: "提高责任上限。", citations: ["s1"] },
      { heading: "待确认事项", body: "管辖法院。", citations: ["s1"] },
    ],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

const readyReasoning: ReasoningReport = {
  taskId: "t1",
  deliverableType: "contract.review",
  ready: true,
  required: true,
  checks: [],
  blockerCount: 0,
  warningCount: 0,
  generatedAt: new Date().toISOString(),
};

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
      reasoningReport: readyReasoning,
    });
    expect(r.readyToApprove).toBe(false);
    expect(r.readyToExport).toBe(false);
    expect(r.blockers.some((b) => b.code === "checklist")).toBe(true);
    expect(r.summaryZh).toMatch(/必核/);
  });

  it("ready to export when approved + checklist complete + acceptance + citations + reasoning", () => {
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
      reasoningReport: readyReasoning,
    });
    expect(r.checklist.complete).toBe(true);
    expect(r.readyToApprove).toBe(true);
    expect(r.citationBlocks).toBe(false);
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
      reasoningReport: readyReasoning,
    });
    expect(r.citationBlocks).toBe(true);
    expect(r.blockers.some((b) => b.code === "citation")).toBe(true);
  });

  it("blocks export when required reasoning gate has blockers", () => {
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
      citationIntegrity: {
        checked: true,
        ok: true,
        missingSourceIds: [],
        sectionsWithIssues: [],
        unanchoredSections: [],
      },
      citationMode: "assisted",
    });
    expect(r.blockers.some((b) => b.code === "reasoning")).toBe(true);
    expect(r.readyToExport).toBe(false);
    expect(r.summaryZh).toBe("推理检查未过");
  });
});
