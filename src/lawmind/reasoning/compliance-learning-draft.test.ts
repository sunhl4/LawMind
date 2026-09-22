import { describe, expect, it } from "vitest";
import type { ResearchBundle, TaskIntent } from "../types.js";
import {
  buildComplianceReportSections,
  buildLearningBriefSections,
} from "./compliance-learning-draft.js";

const emptyBundle: ResearchBundle = {
  taskId: "t1",
  query: "合规",
  sources: [],
  claims: [],
  riskFlags: [],
  missingItems: [],
  requiresReview: true,
  completedAt: new Date().toISOString(),
};

function baseIntent(partial: Partial<TaskIntent>): TaskIntent {
  return {
    taskId: "t1",
    kind: "draft.word",
    output: "docx",
    instruction: "请输出涉外合规卷宗备忘录，含管辖矩阵",
    summary: "数据合规",
    ...partial,
  };
}

describe("compliance-learning-draft", () => {
  it("builds compliance sections with matrix and sources appendix", () => {
    const sections = buildComplianceReportSections(
      baseIntent({ deliverableType: "report.compliance" }),
      emptyBundle,
    );
    const headings = sections.map((s) => s.heading).join("|");
    expect(headings).toMatch(/问题陈述/);
    expect(headings).toMatch(/管辖区效力矩阵/);
    expect(headings).toMatch(/来源附录/);
  });

  it("builds learning brief with authority-aware sections", () => {
    const sections = buildLearningBriefSections(
      baseIntent({
        deliverableType: "report.learning",
        instruction: "写一份学习型调研简报：个人信息保护法要点",
      }),
      {
        ...emptyBundle,
        claims: [
          {
            id: "c1",
            text: "处理个人信息应告知目的",
            confidence: 0.8,
            sourceIds: ["s1"],
            model: "test",
          },
        ],
        sources: [{ id: "s1", title: "PIPL", kind: "statute" }],
      },
    );
    expect(sections.some((s) => s.heading.includes("制度要点"))).toBe(true);
    expect(sections.some((s) => s.heading === "来源")).toBe(true);
  });
});
