import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readResearchOutline } from "../research/outline-store.js";
import type { ResearchBundle, TaskIntent } from "../types.js";
import { buildDraft } from "./keyword-draft.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function bundle(): ResearchBundle {
  return {
    taskId: "task-gate-1",
    query: "q",
    sources: [
      {
        id: "s1",
        title: "官方通知",
        kind: "regulation",
        url: "https://www.samr.gov.cn/x",
      },
    ],
    claims: [
      {
        id: "c1",
        text: "应完成安全评估",
        confidence: 0.8,
        sourceIds: ["s1"],
        model: "t",
      },
    ],
    riskFlags: [],
    missingItems: [],
    requiresReview: true,
    completedAt: new Date().toISOString(),
  };
}

describe("research-draft-gates", () => {
  it("emits outline-only draft until approved", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-outline-"));
    dirs.push(ws);
    const intent: TaskIntent = {
      taskId: "task-gate-1",
      kind: "draft.word",
      output: "docx",
      deliverableType: "report.compliance",
      instruction: "输出涉外合规卷宗备忘录 https://www.samr.gov.cn/x",
      summary: "合规",
      riskLevel: "medium",
      models: ["general", "legal"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    };
    const draft = buildDraft({ intent, bundle: bundle(), workspaceDir: ws });
    expect(draft.title).toMatch(/大纲待确认/);
    expect(draft.sections[0]?.heading).toMatch(/待确认/);
    expect(readResearchOutline(ws, intent.taskId)?.status).toBe("pending");
  });

  it("keeps outline pending when bare 大纲已确认 appears in first ask", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-outline-bare-"));
    dirs.push(ws);
    const intent: TaskIntent = {
      taskId: "task-gate-1",
      kind: "draft.word",
      output: "docx",
      deliverableType: "report.compliance",
      instruction: "输出涉外合规卷宗备忘录。大纲已确认",
      summary: "合规",
      riskLevel: "medium",
      models: ["general", "legal"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    };
    const draft = buildDraft({ intent, bundle: bundle(), workspaceDir: ws });
    expect(draft.title).toMatch(/大纲待确认/);
  });

  it("expands full body after structured clarification resume", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-outline-ok-"));
    dirs.push(ws);
    const intent: TaskIntent = {
      taskId: "task-gate-1",
      kind: "draft.word",
      output: "docx",
      deliverableType: "report.compliance",
      instruction: [
        "输出涉外合规卷宗备忘录。",
        "【补充信息】",
        "请确认或调整研究大纲。",
        "答：大纲已确认",
        "",
        "大纲已确认",
      ].join("\n"),
      summary: "合规",
      riskLevel: "medium",
      models: ["general", "legal"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    };
    const draft = buildDraft({ intent, bundle: bundle(), workspaceDir: ws });
    expect(draft.title).not.toMatch(/大纲待确认/);
    expect(
      draft.clarificationQuestions?.some((q) => q.key === "research_outline_confirm"),
    ).toBeFalsy();
    expect(draft.sections.some((s) => s.heading.includes("管辖区效力矩阵"))).toBe(true);
    expect(
      draft.sections.some((s) => s.body.includes("samr.gov.cn") || s.body.includes("[s1]")),
    ).toBe(true);
  });

  it("uses lawyer-revised outline headings after clarification resume", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-outline-rev-"));
    dirs.push(ws);
    const intent: TaskIntent = {
      taskId: "task-gate-1",
      kind: "draft.word",
      output: "docx",
      deliverableType: "report.compliance",
      instruction: [
        "输出涉外合规卷宗备忘录。",
        "【补充信息】",
        "请确认或调整研究大纲。",
        "答：大纲已确认",
        "",
        "## 律师定制章",
        "- 只写这个要点",
        "- 第二个要点",
        "",
        "大纲已确认",
      ].join("\n"),
      summary: "合规",
      riskLevel: "medium",
      models: ["general", "legal"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    };
    const draft = buildDraft({ intent, bundle: bundle(), workspaceDir: ws });
    expect(draft.title).not.toMatch(/大纲待确认/);
    expect(draft.sections.some((s) => s.heading === "律师定制章")).toBe(true);
    expect(draft.sections.some((s) => s.heading === "已确认研究大纲")).toBe(true);
  });

  it("rebuilds outline after lawyer rejects", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-outline-rej-"));
    dirs.push(ws);
    const intent: TaskIntent = {
      taskId: "task-gate-1",
      kind: "draft.word",
      output: "docx",
      deliverableType: "report.compliance",
      instruction: [
        "输出涉外合规卷宗备忘录。",
        "【补充信息】",
        "请确认或调整研究大纲。",
        "答：不同意大纲",
        "",
        "大纲未通过，请重新生成大纲",
      ].join("\n"),
      summary: "合规",
      riskLevel: "medium",
      models: ["general", "legal"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    };
    const draft = buildDraft({ intent, bundle: bundle(), workspaceDir: ws });
    expect(draft.title).toMatch(/大纲待确认/);
    expect(readResearchOutline(ws, intent.taskId)?.notes.some((n) => /重建/.test(n))).toBe(true);
  });

  it("blocks training draft on unsanitized phone numbers", () => {
    const intent: TaskIntent = {
      taskId: "task-ppt-1",
      kind: "draft.ppt",
      output: "pptx",
      deliverableType: "ppt.training",
      instruction: "做培训 PPT，当事人电话 13800138000",
      summary: "培训",
      riskLevel: "low",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    };
    expect(() => buildDraft({ intent, bundle: bundle() })).toThrow(/脱敏/);
  });
});
