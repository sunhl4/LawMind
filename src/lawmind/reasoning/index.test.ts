/**
 * Unit tests for Reasoning Layer (bundle -> draft).
 */

import { describe, it, expect } from "vitest";
import type { TaskIntent, ResearchBundle } from "../types.js";
import { buildDraft } from "./index.js";

function minimalIntent(overrides: Partial<TaskIntent> = {}): TaskIntent {
  return {
    taskId: "test-task-1",
    kind: "analyze.contract",
    output: "docx",
    instruction: "请审查一份合同",
    summary: "合同审查",
    riskLevel: "medium",
    models: ["general", "legal"],
    requiresConfirmation: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function minimalBundle(overrides: Partial<ResearchBundle> = {}): ResearchBundle {
  return {
    taskId: "test-task-1",
    query: "审查合同",
    sources: [],
    claims: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("LawMind Reasoning buildDraft", () => {
  it("produces pending draft with default title and templateId", () => {
    const intent = minimalIntent();
    const bundle = minimalBundle();
    const draft = buildDraft({ intent, bundle });

    expect(draft.reviewStatus).toBe("pending");
    expect(draft.taskId).toBe("test-task-1");
    expect(draft.title).toBe("合同审查意见书");
    expect(draft.templateId).toBe("word/contract-default");
    expect(draft.output).toBe("docx");
    expect(draft.sections.length).toBeGreaterThanOrEqual(1);
    expect(draft.sections[0].heading).toBe("审查结论");
    expect(draft.sections[1].heading).toBe("检索结果");
    expect(draft.sections[1].body).toContain("未检索到可引用结论");
  });

  it("uses custom title and templateId when provided", () => {
    const intent = minimalIntent();
    const bundle = minimalBundle();
    const draft = buildDraft({
      intent,
      bundle,
      title: "某某合同审查意见",
      templateId: "word/contract-default",
    });

    expect(draft.title).toBe("某某合同审查意见");
    expect(draft.templateId).toBe("word/contract-default");
  });

  it("turns claims into sections with confidence and citations", () => {
    const intent = minimalIntent();
    const bundle = minimalBundle({
      sources: [{ id: "s1", title: "民法典", kind: "statute" }],
      claims: [
        {
          text: "违约金约定过高可请求调整。",
          sourceIds: ["s1"],
          confidence: 0.9,
          model: "legal",
        },
      ],
    });
    const draft = buildDraft({ intent, bundle });

    const claimSection = draft.sections.find((s) => s.heading === "审查意见 1");
    expect(claimSection).toBeDefined();
    expect(claimSection!.body).toContain("违约金");
    expect(claimSection!.body).toContain("90%");
    expect(claimSection!.citations).toEqual(["s1"]);
  });

  it("adds risk flags and missing items sections", () => {
    const intent = minimalIntent();
    const bundle = minimalBundle({
      riskFlags: ["条款存在歧义"],
      missingItems: ["需补充对方主体资质证明"],
    });
    const draft = buildDraft({ intent, bundle });

    const riskSection = draft.sections.find((s) => s.heading === "主要风险提示");
    expect(riskSection).toBeDefined();
    expect(riskSection!.body).toContain("条款存在歧义");

    const missingSection = draft.sections.find((s) => s.heading === "待确认事项");
    expect(missingSection).toBeDefined();
    expect(missingSection!.body).toContain("主体资质证明");
  });

  it("adds conflict section when same-topic positive and negative claims exist", () => {
    const intent = minimalIntent();
    // 冲突检测用「去掉否定词后」的标准化 key 分组；须同一 key 下既有肯定又有否定
    const bundle = minimalBundle({
      claims: [
        { text: "甲方应承担责任", sourceIds: [], confidence: 0.8, model: "general" },
        { text: "甲方不应承担责任", sourceIds: [], confidence: 0.7, model: "legal" },
      ],
    });
    const draft = buildDraft({ intent, bundle });

    const conflictSection = draft.sections.find((s) => s.heading === "冲突意见（需律师裁定）");
    expect(conflictSection).toBeDefined();
    expect(conflictSection!.body).toContain("冲突");
  });

  it("uses PPT default title when intent.kind is draft.ppt", () => {
    const intent = minimalIntent({ kind: "draft.ppt", output: "pptx" });
    const bundle = minimalBundle();
    const draft = buildDraft({ intent, bundle });

    expect(draft.title).toBe("LawMind 客户汇报草稿");
    expect(draft.templateId).toBe("ppt/client-brief-default");
    expect(draft.output).toBe("pptx");
  });

  it("builds a full rental contract skeleton for deliverable-first word drafts", () => {
    const intent = minimalIntent({
      kind: "draft.word",
      instruction: "请起草一份房屋租赁合同",
      summary: "生成完整房屋租赁合同",
      riskLevel: "high",
      requiresConfirmation: true,
      deliverableType: "contract.rental",
      acceptanceCriteria: ["输出完整合同正文"],
      clarificationQuestions: [
        { key: "rent_and_deposit", question: "请补充租金和押金。", reason: "核心商务条款缺失" },
      ],
    });
    const draft = buildDraft({ intent, bundle: minimalBundle() });

    expect(draft.title).toBe("房屋租赁合同");
    expect(draft.templateId).toBe("word/contract-default");
    expect(draft.sections.some((s) => s.heading === "合同当事人")).toBe(true);
    expect(draft.sections.some((s) => s.heading === "第三条 租金、押金及支付方式")).toBe(true);
    expect(draft.clarificationQuestions?.[0]?.key).toBe("rent_and_deposit");
  });
});
