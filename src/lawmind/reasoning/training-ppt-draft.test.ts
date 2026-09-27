import { describe, expect, it } from "vitest";
import type { ResearchBundle, TaskIntent } from "../types.js";
import {
  buildTrainingPptSections,
  inferTrainingDeckVariant,
  trainingTemplateIdForVariant,
} from "./training-ppt-draft.js";

const bundle: ResearchBundle = {
  taskId: "t1",
  query: "培训",
  sources: [{ id: "s1", title: "官方指南", kind: "web", url: "https://example.com" }],
  claims: [
    {
      id: "c1",
      text: "跨境传输需评估",
      confidence: 0.7,
      sourceIds: ["s1"],
      model: "test",
    },
  ],
  riskFlags: ["未完成安全评估"],
  missingItems: [],
  requiresReview: false,
  completedAt: new Date().toISOString(),
};

function pptIntent(instruction: string): TaskIntent {
  return {
    taskId: "t1",
    kind: "draft.ppt",
    output: "pptx",
    deliverableType: "ppt.training",
    instruction,
    summary: "培训",
  };
}

describe("training-ppt-draft", () => {
  it("selects cross-border variant and template", () => {
    const v = inferTrainingDeckVariant(pptIntent("跨境合规培训 欧盟 GDPR"));
    expect(v).toBe("crossborderMatrix");
    expect(trainingTemplateIdForVariant(v)).toBe("ppt/crossborder-matrix-default");
  });

  it("builds CLE-style sections with agenda and sources", () => {
    const sections = buildTrainingPptSections(pptIntent("客户合规培训 CLE 30分钟"), bundle);
    expect(sections.some((s) => s.heading.includes("议程") || s.heading.includes("大纲"))).toBe(
      true,
    );
    expect(sections.some((s) => s.heading.includes("来源") || s.heading.includes("规则"))).toBe(
      true,
    );
  });

  it("case clinic instruction text (phone number) does not leak into slides via the outline path", () => {
    // 大纲缺省即 approved（research-outline.ts）：不再产 caseClinic 变体节，
    // 幻灯片按大纲展开——指令原文（含手机号）不得进任何一页。
    const sections = buildTrainingPptSections(
      pptIntent("案件诊所式培训 本案 电话 13800138000 已脱敏"),
      bundle,
    );
    expect(sections.some((s) => s.heading.includes("已确认课件大纲"))).toBe(true);
    expect(sections.some((s) => s.heading.includes("事实时间线"))).toBe(false);
    for (const s of sections) {
      expect(s.body).not.toContain("13800138000");
    }
  });
});
