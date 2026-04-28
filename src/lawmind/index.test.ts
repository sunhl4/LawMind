/**
 * Integration tests for LawMind engine (plan -> research -> draft) with mock adapters.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readAllAuditLogs } from "./audit/index.js";
import { persistDraft } from "./drafts/index.js";
import {
  createLawMindEngine,
  createGeneralModelAdapter,
  createLegalModelAdapter,
  createWorkspaceAdapter,
} from "./index.js";
import { ensureTaskRecord } from "./tasks/index.js";
import type { ArtifactDraft, TaskIntent } from "./types.js";

describe("LawMind Engine", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-test-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("plan -> research -> draft produces draft with sections", async () => {
    const mockGeneral = createGeneralModelAdapter(async () => ({
      claims: [{ text: "需核对事实与证据清单。", confidence: 0.85 }],
      sources: [{ title: "工作流规范", citation: "MEMORY.md" }],
    }));
    const mockLegal = createLegalModelAdapter(async () => ({
      claims: [{ text: "应明确适用法条版本。", confidence: 0.9 }],
      sources: [{ title: "法律检索规则", citation: "内部规则" }],
    }));

    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockGeneral, mockLegal],
    });

    const intent = engine.plan("请整理合同审查意见并生成律师函草稿", {
      audience: "客户",
      matterId: "matter-123",
      templateId: "word/demand-letter-default",
    });

    expect(intent.kind).toBe("draft.word");
    expect(intent.taskId).toBeDefined();
    expect(intent.riskLevel).toBe("high");

    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const bundle = await engine.research(intent);

    expect(bundle.sources.length).toBeGreaterThanOrEqual(0);
    // 检索管线在 mock 下至少产出 1 条结论
    expect(bundle.claims.length).toBeGreaterThanOrEqual(1);
    expect(bundle.taskId).toBe(intent.taskId);
    const researchingState = engine.getTaskState(intent.taskId);
    expect(researchingState?.status).toBe("researched");
    expect(researchingState?.matterId).toBe("matter-123");

    const draft = engine.draft(intent, bundle, {
      title: "Integration Test 律师函草稿",
    });

    expect(draft.reviewStatus).toBe("pending");
    expect(draft.title).toBe("Integration Test 律师函草稿");
    expect(draft.sections.length).toBeGreaterThanOrEqual(1);
    expect(draft.sections[0].heading).toBe("抬头");
    expect(draft.sections.map((s) => s.heading)).toContain("事实背景");
    expect(engine.getDraft(intent.taskId)?.title).toBe("Integration Test 律师函草稿");

    const draftedState = engine.getTaskState(intent.taskId);
    expect(draftedState?.status).toBe("drafted");
    expect(draftedState?.templateId).toBe("word/demand-letter-default");
    expect(draftedState?.draftPath).toContain(`${intent.taskId}.json`);

    const researchSnap = path.join(workspaceDir, "drafts", `${intent.taskId}.research.json`);
    const snapRaw = await fs.readFile(researchSnap, "utf8");
    expect(JSON.parse(snapRaw).taskId).toBe(intent.taskId);

    await engine.review(draft, { actorId: "lawyer:test", status: "approved" });
    const reviewedState = engine.getTaskState(intent.taskId);
    expect(reviewedState?.status).toBe("reviewed");
    expect(reviewedState?.reviewStatus).toBe("approved");

    const caseContent = await fs.readFile(
      path.join(workspaceDir, "cases", "matter-123", "CASE.md"),
      "utf8",
    );
    expect(caseContent).toContain("任务目标");
    expect(caseContent).toContain(intent.taskId);
    expect(caseContent).toContain("检索完成");
    expect(caseContent).toContain("草稿审核完成：approved");
    expect(caseContent).toContain("来源模型");
  });

  it("reopenDraftReview resets non-pending review to pending", async () => {
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");
    const taskId = "reopen-engine-task";
    const now = new Date().toISOString();
    const intent: TaskIntent = {
      taskId,
      kind: "analyze.contract",
      output: "docx",
      instruction: "test reopen",
      summary: "x",
      riskLevel: "low",
      models: ["legal"],
      requiresConfirmation: false,
      createdAt: now,
      matterId: "m-reopen",
      templateId: "word/contract-default",
    };
    ensureTaskRecord(workspaceDir, intent);
    const d: ArtifactDraft = {
      taskId,
      matterId: "m-reopen",
      title: "T",
      output: "docx",
      templateId: "word/contract-default",
      summary: "s",
      sections: [{ heading: "正文", body: "b" }],
      reviewNotes: [],
      reviewStatus: "modified",
      createdAt: now,
    };
    persistDraft(workspaceDir, d);
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir)],
    });
    const reopened = await engine.reopenDraftReview(taskId, { actorId: "lawyer:reopen" });
    expect(reopened?.reviewStatus).toBe("pending");
    expect(engine.getTaskState(taskId)?.reviewStatus).toBe("pending");
    expect(engine.getTaskState(taskId)?.status).toBe("drafted");
  });

  it("emits draft.citation_integrity when review sees citations missing from bundle", async () => {
    const mockLegal = createLegalModelAdapter(async () => ({
      claims: [{ text: "结论。", sourceIds: ["s-ok"], confidence: 0.9, model: "legal" }],
      sources: [{ id: "s-ok", title: "规则", kind: "statute" }],
    }));
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockLegal],
    });
    const intent = engine.plan("请整理合同审查意见并生成律师函草稿", {
      audience: "客户",
      matterId: "matter-cite-audit",
      templateId: "word/demand-letter-default",
    });
    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const bundle = await engine.research(intent);
    engine.draft(intent, bundle, { title: "Citation audit draft" });
    const draftPath = path.join(workspaceDir, "drafts", `${intent.taskId}.json`);
    const dj = JSON.parse(await fs.readFile(draftPath, "utf8")) as {
      sections: Array<{ heading: string; body: string; citations?: string[] }>;
    };
    dj.sections = [{ heading: "H", body: "x", citations: ["s-ok", "ghost"] }];
    await fs.writeFile(draftPath, JSON.stringify(dj, null, 2));
    const loaded = engine.getDraft(intent.taskId);
    expect(loaded).toBeDefined();
    await engine.review(loaded!, { actorId: "lawyer:test", status: "approved" });
    const auditDir = path.join(workspaceDir, "audit");
    const events = await readAllAuditLogs(auditDir);
    expect(events.some((e) => e.kind === "draft.citation_integrity")).toBe(true);
    expect(events.filter((e) => e.kind === "draft.reviewed").length).toBeGreaterThanOrEqual(1);
  });

  it("blocks high-risk research until task is confirmed", async () => {
    const mockLegal = createLegalModelAdapter(async () => ({
      claims: [{ text: "需核对催款依据。", confidence: 0.82 }],
      sources: [{ title: "律师函规则", citation: "内部规则" }],
    }));
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockLegal],
    });

    const intent = engine.plan("写一封催款律师函");
    await expect(engine.research(intent)).rejects.toThrow("需要先确认");

    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const confirmedState = engine.getTaskState(intent.taskId);
    expect(confirmedState?.status).toBe("confirmed");

    const bundle = await engine.research(intent);
    expect(bundle.claims.length).toBeGreaterThanOrEqual(1);
  });

  it("render returns error when draft is not approved", async () => {
    const mockGeneral = createGeneralModelAdapter(async () => ({
      claims: [],
      sources: [],
    }));
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockGeneral],
    });

    const intent = engine.plan("审查合同");
    const bundle = await engine.research(intent);
    const draft = engine.draft(intent, bundle);

    expect(draft.reviewStatus).toBe("pending");
    const result = await engine.render(draft);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("未通过审核");

    const auditDir = path.join(workspaceDir, "audit");
    const auditEvents = await readAllAuditLogs(auditDir);
    expect(
      auditEvents.filter((e) => e.taskId === intent.taskId && e.kind === "artifact.rendered"),
    ).toEqual([]);
  });

  it("render writes pptx when draft.output is pptx", async () => {
    const mockGeneral = createGeneralModelAdapter(async () => ({
      claims: [{ text: "客户汇报要点。", confidence: 0.88 }],
      sources: [{ title: "内部材料", citation: "工作区" }],
    }));
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockGeneral],
    });

    const intent = engine.plan("为客户准备案件进展PPT汇报", { matterId: "matter-ppt" });
    expect(intent.output).toBe("pptx");
    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const bundle = await engine.research(intent);
    const draft = engine.draft(intent, bundle, { title: "PPT 集成测试草稿" });
    expect(draft.output).toBe("pptx");
    await engine.review(draft, { actorId: "lawyer:test", status: "approved" });
    const result = await engine.render(draft);

    expect(result.ok).toBe(true);
    expect(result.outputPath).toMatch(/\.pptx$/);
    const renderedState = engine.getTaskState(intent.taskId);
    expect(renderedState?.status).toBe("rendered");
  });

  it("render persists final output path after approved review", async () => {
    const mockLegal = createLegalModelAdapter(async () => ({
      claims: [{ text: "应核对合同解除条款。", confidence: 0.91 }],
      sources: [{ title: "合同法务规则", citation: "内部规则" }],
    }));
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockLegal],
    });

    const intent = engine.plan("审查合同", { matterId: "matter-456" });
    const bundle = await engine.research(intent);
    const draft = engine.draft(intent, bundle);
    await engine.review(draft, { actorId: "lawyer:test", status: "approved" });
    const result = await engine.render(draft);

    expect(result.ok).toBe(true);
    const renderedState = engine.getTaskState(intent.taskId);
    expect(renderedState?.status).toBe("rendered");
    expect(renderedState?.outputPath).toBe(result.outputPath);

    const caseContent = await fs.readFile(
      path.join(workspaceDir, "cases", "matter-456", "CASE.md"),
      "utf8",
    );
    expect(caseContent).toContain("## 9. 生成产物");
    expect(caseContent).toContain(String(result.outputPath));
  });

  it("falls back to built-in template when requested template is unknown", async () => {
    const mockGeneral = createGeneralModelAdapter(async () => ({
      claims: [{ text: "应整理证据目录。", confidence: 0.88 }],
      sources: [{ title: "证据清单", citation: "workspace" }],
    }));
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockGeneral],
    });

    const intent = engine.plan("生成客户汇报文书", {
      matterId: "matter-fallback",
      templateId: "upload/nonexistent-template",
    });
    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const bundle = await engine.research(intent);
    const draft = engine.draft(intent, bundle, {
      templateId: "upload/nonexistent-template",
      title: "Fallback Template Test",
    });
    await engine.review(draft, { actorId: "lawyer:test", status: "approved" });
    const result = await engine.render(draft);

    expect(result.ok).toBe(true);
    const auditDir = path.join(workspaceDir, "audit");
    const auditFiles = await fs.readdir(auditDir);
    const latestAudit = path.join(auditDir, auditFiles.toSorted()[auditFiles.length - 1]);
    const auditContent = await fs.readFile(latestAudit, "utf8");
    expect(auditContent).toContain("回退原因");
  });

  it("review with playbook trigger labels appends CLAUSE_PLAYBOOK and emits memory.playbook_updated", async () => {
    const mockLegal = createLegalModelAdapter(async () => ({
      claims: [{ text: "结论。", confidence: 0.9 }],
      sources: [{ title: "规则", citation: "r" }],
    }));
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockLegal],
    });
    const intent = engine.plan("请整理合同审查意见并生成律师函草稿", {
      audience: "客户",
      matterId: "matter-playbook",
      templateId: "word/demand-letter-default",
    });
    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const bundle = await engine.research(intent);
    const draft = engine.draft(intent, bundle, { title: "Playbook integration" });
    await engine.review(draft, {
      actorId: "lawyer:test",
      status: "approved",
      labels: ["citation.incomplete"],
      note: "add refs",
    });
    const pb = path.join(workspaceDir, "playbooks", "CLAUSE_PLAYBOOK.md");
    const pbContent = await fs.readFile(pb, "utf8");
    expect(pbContent).toContain("## 6. LawMind 审核学习（自动摘要）");
    expect(pbContent).toContain("citation.incomplete");
    const auditDir = path.join(workspaceDir, "audit");
    const events = await readAllAuditLogs(auditDir);
    expect(events.some((e) => e.kind === "memory.playbook_updated")).toBe(true);
  });

  it("recordQuality writes quality/dashboard.json aggregate", async () => {
    const mockLegal = createLegalModelAdapter(async () => ({
      claims: [{ text: "结论。", confidence: 0.9 }],
      sources: [{ title: "规则", citation: "r" }],
    }));
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockLegal],
    });
    const intent = engine.plan("请整理合同审查意见并生成律师函草稿", {
      audience: "客户",
      matterId: "matter-dash-json",
      templateId: "word/demand-letter-default",
    });
    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const bundle = await engine.research(intent);
    const draft = engine.draft(intent, bundle, { title: "Dashboard JSON test" });
    await engine.review(draft, { actorId: "lawyer:test", status: "approved" });
    await engine.recordQuality(intent.taskId, { labels: ["quality.good_example"] });
    const dashPath = path.join(workspaceDir, "quality", "dashboard.json");
    const raw = await fs.readFile(dashPath, "utf8");
    const dash = JSON.parse(raw) as { recordCount: number; records: Array<{ taskId: string }> };
    expect(dash.recordCount).toBeGreaterThanOrEqual(1);
    expect(dash.records.some((r) => r.taskId === intent.taskId)).toBe(true);
  });
});
