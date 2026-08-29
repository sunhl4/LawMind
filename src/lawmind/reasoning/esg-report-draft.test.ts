import { describe, expect, it } from "vitest";
import type { ResearchBundle, TaskIntent } from "../types.js";
import { buildEsgReportSections, inferEsgReportTitle } from "./esg-report-draft.js";
import { buildDraft } from "./keyword-draft.js";

function esgIntent(overrides: Partial<TaskIntent> = {}): TaskIntent {
  return {
    taskId: "t-esg-1",
    kind: "draft.word",
    output: "docx",
    deliverableType: "report.esg",
    instruction: "很好现在我需要你帮我写一个详细的欧盟对于新能源汽车相关的ESG报告",
    summary: "生成欧盟新能源汽车 ESG 报告",
    riskLevel: "high",
    models: ["general", "legal"],
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function esgBundle(): ResearchBundle {
  return {
    taskId: "t-esg-1",
    query: "欧盟 新能源汽车 ESG",
    sources: [
      { id: "s1", title: "CSRD 指令摘要", kind: "regulation" },
      { id: "s2", title: "EU Battery Regulation", kind: "regulation" },
    ],
    claims: [
      {
        text: "欧盟新能源汽车ESG合规主要受 CSRD、EU Taxonomy 及新电池法约束。",
        confidence: 0.95,
        sourceIds: ["s1", "s2"],
        model: "legal",
      },
      {
        text: "新电池法要求对动力电池进行碳足迹声明，并设定最低回收材料比例。",
        confidence: 0.95,
        sourceIds: ["s2"],
        model: "legal",
      },
      {
        text: "CSRD 要求企业采用双重重要性原则进行 ESG 信息披露，并符合 ESRS。",
        confidence: 0.95,
        sourceIds: ["s1"],
        model: "legal",
      },
    ],
    riskFlags: ["定量 KPI 待企业补充"],
    missingItems: ["具体披露主体与报告年度"],
    requiresReview: true,
    completedAt: new Date().toISOString(),
  };
}

describe("esg-report-draft", () => {
  it("infers EU NEV ESG title from instruction", () => {
    expect(inferEsgReportTitle(esgIntent())).toBe("欧盟新能源汽车行业 ESG 合规与披露报告");
  });

  it("builds structured ESG sections instead of placeholder body", () => {
    const sections = buildEsgReportSections(esgIntent(), esgBundle());
    expect(sections.some((s) => s.heading === "执行摘要")).toBe(true);
    expect(sections.some((s) => s.heading === "二、监管与合规框架")).toBe(true);
    expect(sections.some((s) => s.heading === "三、环境（E）维度")).toBe(true);
    expect(sections.some((s) => s.heading === "四、社会（S）维度")).toBe(true);
    expect(sections.some((s) => s.heading === "五、治理（G）维度")).toBe(true);
    expect(sections.some((s) => s.body.includes("请根据任务要求补足正文内容"))).toBe(false);
    expect(sections.some((s) => s.heading === "要点 1")).toBe(false);
  });

  it("buildDraft uses ESG title and multi-section structure for report.esg", () => {
    const draft = buildDraft({ intent: esgIntent(), bundle: esgBundle() });
    expect(draft.title).toBe("欧盟新能源汽车行业 ESG 合规与披露报告");
    expect(draft.sections.length).toBeGreaterThanOrEqual(8);
    expect(draft.sections[0]?.heading).toBe("执行摘要");
  });
});
