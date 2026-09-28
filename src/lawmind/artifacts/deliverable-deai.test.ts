import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { polishDeliverableDraft } from "./deliverable-deai.js";

function makeDraft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "deai-task",
    title: "进度汇报",
    output: "docx",
    templateId: "word/research-report-default",
    summary: "总之，项目按期推进。",
    sections: [],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: "2026-09-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("polishDeliverableDraft", () => {
  it("strips product self-refs and chat closers by default", () => {
    const { draft, changes } = polishDeliverableDraft(
      makeDraft({
        summary: "自：LawMind 法律助理\n希望这对你有帮助。",
        sections: [
          {
            heading: "一、结论",
            body: "作为 AI，闭环已赋能落地。值得注意的是，进度正常。",
            citations: [],
          },
        ],
      }),
    );
    expect(draft.summary).not.toContain("LawMind");
    expect(draft.summary).not.toContain("希望这对你有帮助");
    expect(draft.sections[0]?.body).not.toContain("赋能");
    expect(draft.sections[0]?.body).not.toContain("闭环");
    expect(draft.sections[0]?.body).not.toContain("值得注意的是");
    expect(changes.some((c) => c.kind === "strip_product" || c.kind === "phrase")).toBe(true);
  });

  it("drops AI workbench sections", () => {
    const { draft, changes } = polishDeliverableDraft(
      makeDraft({
        sections: [
          { heading: "0. 检索/研究策略", body: "关键词：竞业", citations: [] },
          { heading: "一、结论", body: "结论正文", citations: [] },
          { heading: "支撑材料", body: "[L-01]", citations: [] },
        ],
      }),
    );
    expect(draft.sections.map((s) => s.heading)).toEqual(["一、结论"]);
    expect(changes.filter((c) => c.kind === "drop_section")).toHaveLength(2);
  });

  it("renames 法律分析 to 分析 for business reports only", () => {
    const business = polishDeliverableDraft(
      makeDraft({
        deliverableType: "report.general",
        sections: [{ heading: "四、法律分析", body: "进度与风险。", citations: [] }],
      }),
    );
    expect(business.draft.sections[0]?.heading).toBe("四、分析");

    const legal = polishDeliverableDraft(
      makeDraft({
        deliverableType: "memo.research",
        sections: [{ heading: "四、法律分析", body: "规范适用。", citations: [] }],
      }),
    );
    expect(legal.draft.sections[0]?.heading).toBe("四、法律分析");
  });

  it("keeps statute citations and case numbers untouched", () => {
    const body = "依据《民法典》第577条及（2024）沪01民终1234号判决。";
    const { draft } = polishDeliverableDraft(
      makeDraft({
        sections: [{ heading: "三、法律分析", body, citations: ["npc-1"] }],
        deliverableType: "memo.research",
      }),
    );
    expect(draft.sections[0]?.body).toBe(body);
  });
});
