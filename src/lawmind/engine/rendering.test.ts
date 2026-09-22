/**
 * Engine rendering — unit tests for strict gate blocking.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { persistDraft } from "../drafts/index.js";
import type { ArtifactDraft } from "../types.js";
import { buildEngineContext } from "./context.js";
import { renderDraft } from "./rendering.js";

describe("engine/rendering", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-rendering-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "artifacts"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("blocks render when citationGateStrict and draft has missing source ids", async () => {
    const { persistResearchSnapshot } = await import("../drafts/research-snapshot.js");
    const draft: ArtifactDraft = {
      taskId: "task-cite-block",
      matterId: "matter-1",
      title: "Cite blocked",
      summary: "summary",
      sections: [
        {
          heading: "结论",
          body: "本合同违约金过高，建议调整。".repeat(8),
          citations: ["ghost-source"],
        },
      ],
      reviewStatus: "approved",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    persistResearchSnapshot(workspaceDir, {
      taskId: draft.taskId,
      query: "q",
      sources: [{ id: "s1", title: "真实来源", kind: "statute" }],
      claims: [],
      riskFlags: [],
      missingItems: [],
      requiresReview: false,
      completedAt: new Date().toISOString(),
    });
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const result = await renderDraft(ctx, draft, {
      strictGates: false,
      citationGateStrict: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/引用完整性/);
    expect(result.citationIntegrity?.checked).toBe(true);
  });

  it("writes a new deliverable under the matter artifacts folder with a date name", async () => {
    const draft: ArtifactDraft = {
      taskId: "task-out-loc",
      matterId: "matter-out",
      title: "文件可见范围扩展方案",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文。", citations: [] }],
      reviewStatus: "approved",
      reviewNotes: [],
      output: "docx",
      templateId: "word/legal-memo-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const result = await renderDraft(ctx, draft, { strictGates: false, citationGateStrict: false });
    expect(result.ok).toBe(true);
    expect(result.outputPath).toMatch(
      /cases[/\\]matter-out[/\\]artifacts[/\\]文件可见范围扩展方案_\d{8}_01\.docx$/,
    );
    expect(result.outputPath).not.toMatch(/_[0-9a-f]{8}\.docx$/i);
    expect(result.outputPath && (await fs.stat(result.outputPath)).isFile()).toBe(true);
  });

  it("blocks export when an outbound deliverable has mechanical lint blockers", async () => {
    const draft: ArtifactDraft = {
      taskId: "task-lint-gate",
      matterId: "matter-lint",
      title: "房屋租赁合同审查意见",
      summary: "summary",
      sections: [
        {
          heading: "一、合同本体",
          body: "房屋租赁合同。租赁期限 25 年，租金按月支付。双方按约履行各自义务。",
          citations: [],
        },
      ],
      reviewStatus: "approved",
      reviewNotes: [],
      output: "docx",
      templateId: "word/legal-memo-default",
      deliverableType: "contract.review",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const result = await renderDraft(ctx, draft, { strictGates: false, citationGateStrict: false });
    expect(result.ok).toBe(false);
    expect(result.lintBlockerRuleIds).toContain("lease.term_cap");
    expect(result.lintReport).toBeDefined();
    expect(result.error).toContain("收窄");
    // 拦截时不得写出 Word 文件。
    expect(result.outputPath).toBeUndefined();
  });

  it("does not gate internal deliverables (memo.internal stays advisory)", async () => {
    const draft: ArtifactDraft = {
      taskId: "task-lint-internal",
      matterId: "matter-lint",
      title: "内部备忘",
      summary: "summary",
      sections: [
        {
          heading: "背景",
          body: "房屋租赁合同。租赁期限 25 年，租金按月支付。双方按约履行各自义务。",
          citations: [],
        },
      ],
      reviewStatus: "approved",
      reviewNotes: [],
      output: "docx",
      templateId: "word/legal-memo-default",
      deliverableType: "memo.internal",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const result = await renderDraft(ctx, draft, { strictGates: false, citationGateStrict: false });
    expect(result.ok).toBe(true);
    expect(result.lintBlockerRuleIds).toBeUndefined();
  });

  it("does not block export on judgment-class findings (deposit cap stays advisory)", async () => {
    const draft: ArtifactDraft = {
      taskId: "task-lint-deposit",
      matterId: "matter-lint",
      title: "供货合同审查意见",
      summary: "summary",
      sections: [
        {
          heading: "定金条款",
          body: "供货合同审查意见。定金为本合同标的额的 30%，其余条款按约定履行，风险总体可控。",
          citations: [],
        },
      ],
      reviewStatus: "approved",
      reviewNotes: [],
      output: "docx",
      templateId: "word/legal-memo-default",
      deliverableType: "contract.review",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const result = await renderDraft(ctx, draft, { strictGates: false, citationGateStrict: false });
    expect(result.ok).toBe(true);
    expect(result.outputPath).toBeDefined();
  });
});
