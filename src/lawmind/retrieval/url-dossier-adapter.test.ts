import { describe, expect, it } from "vitest";
import type { TaskIntent } from "../types.js";
import { createUrlDossierAdapter } from "./url-dossier-adapter.js";

describe("url-dossier-adapter", () => {
  it("supports compliance instructions that contain URLs", () => {
    const adapter = createUrlDossierAdapter("/tmp/ws");
    const intent: TaskIntent = {
      taskId: "t1",
      kind: "draft.word",
      output: "docx",
      deliverableType: "report.compliance",
      instruction: "请抓取 https://www.samr.gov.cn/a 并出卷宗",
      summary: "合规",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    };
    expect(adapter.supports(intent)).toBe(true);
  });

  it("does not support training without URLs", () => {
    const adapter = createUrlDossierAdapter("/tmp/ws");
    const intent: TaskIntent = {
      taskId: "t2",
      kind: "draft.ppt",
      output: "pptx",
      deliverableType: "ppt.training",
      instruction: "做脱敏培训课件",
      summary: "培训",
      riskLevel: "low",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    };
    expect(adapter.supports(intent)).toBe(false);
  });
});
