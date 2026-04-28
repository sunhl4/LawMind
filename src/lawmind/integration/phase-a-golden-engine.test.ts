/**
 * Phase A：引擎黄金路径（无 LLM、无 HTTP）
 * matter 创建 → 任务 + 草稿 → 审核通过 → docx 渲染；并校验审计文件非空。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAllAuditLogs } from "../audit/index.js";
import { createMatterIfAbsent } from "../cases/matter-create.js";
import { persistDraft } from "../drafts/index.js";
import { createLawMindEngine } from "../index.js";
import { ensureTaskRecord } from "../tasks/index.js";
import type { ArtifactDraft, TaskIntent } from "../types.js";

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-golden-"));
}

describe("Phase A golden engine path", () => {
  let ws: string;

  afterEach(() => {
    if (ws) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("create matter, review draft, render docx, audit trail present", async () => {
    ws = tmpWorkspace();
    const matterId = "golden-matter-01";
    await createMatterIfAbsent(ws, matterId);

    const now = new Date().toISOString();
    const taskId = "golden-task-01";
    const intent: TaskIntent = {
      taskId,
      kind: "draft.word",
      output: "docx",
      instruction: "生成测试用法律备忘录",
      summary: "Phase A golden path",
      riskLevel: "low",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: now,
      matterId,
      templateId: "word/legal-memo-default",
    };
    ensureTaskRecord(ws, intent);

    const draft: ArtifactDraft = {
      taskId,
      matterId,
      title: "Golden memo",
      output: "docx",
      templateId: "word/legal-memo-default",
      summary: "Golden summary",
      sections: [{ heading: "结论", body: "测试正文", citations: ["s1"] }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    };
    persistDraft(ws, draft);

    const engine = createLawMindEngine({ workspaceDir: ws, adapters: [] });
    const reviewed = await engine.review(draft, {
      status: "approved",
      actorId: "lawyer:phase-a-test",
      note: "golden approve",
    });
    expect(reviewed.reviewStatus).toBe("approved");

    const renderResult = await engine.render(reviewed);
    expect(renderResult.ok).toBe(true);
    expect(renderResult.outputPath).toMatch(/\.docx$/);
    expect(fs.existsSync(renderResult.outputPath!)).toBe(true);

    const auditDir = path.join(ws, "audit");
    const events = await readAllAuditLogs(auditDir);
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has("draft.reviewed")).toBe(true);
    expect(kinds.has("artifact.rendered")).toBe(true);

    const forTask = events.filter((e) => e.taskId === taskId);
    const reviewedAt = forTask.find((e) => e.kind === "draft.reviewed")?.timestamp;
    const rendered = forTask.filter((e) => e.kind === "artifact.rendered");
    expect(reviewedAt).toBeDefined();
    expect(rendered.length).toBe(1);
    const renderedEvent = rendered[0];
    expect(renderedEvent).toBeDefined();
    if (!renderedEvent || !reviewedAt) {
      throw new Error("expected reviewed and rendered audit events");
    }
    expect(renderedEvent.timestamp.localeCompare(reviewedAt)).toBeGreaterThanOrEqual(0);
    expect(renderedEvent.detail).toContain("模板：");
    expect(renderedEvent.detail).toContain("输出路径：");
    expect(renderedEvent.detail).toContain(renderResult.outputPath!);
  });
});
