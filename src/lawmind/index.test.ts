/**
 * Integration tests for LawMind engine (plan -> research -> draft) with mock adapters.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createLawMindEngine,
  createGeneralModelAdapter,
  createLegalModelAdapter,
  createWorkspaceAdapter,
} from "./index.js";

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

    expect(intent.kind).toBe("analyze.contract");
    expect(intent.taskId).toBeDefined();
    expect(intent.riskLevel).toBe("medium");

    const bundle = await engine.research(intent);

    expect(bundle.sources.length).toBeGreaterThanOrEqual(0);
    // analyze.contract 只触发 legal 适配器，general 不支持；至少 1 条结论
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
    expect(draft.sections[0].heading).toBe("检索结论摘要");
    expect(engine.getDraft(intent.taskId)?.title).toBe("Integration Test 律师函草稿");

    const draftedState = engine.getTaskState(intent.taskId);
    expect(draftedState?.status).toBe("drafted");
    expect(draftedState?.templateId).toBe("word/demand-letter-default");
    expect(draftedState?.draftPath).toContain(`${intent.taskId}.json`);

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
});
