import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveWorkspacePlaybook } from "../deliverables/playbook-store.js";
import { readDraft } from "../drafts/index.js";
import { appendProductMetric } from "../metrics/product-metrics.js";
import type { ArtifactDraft, ResearchBundle } from "../types.js";
import { buildEngineContext } from "./context.js";
import { persistDraftPipeline } from "./shared.js";

const dirs: string[] = [];

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  await Promise.all(
    dirs
      .splice(0)
      .map((dir) => fsPromises.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-persist-"));
  dirs.push(ws);
  fs.mkdirSync(path.join(ws, "memory"), { recursive: true });
  fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
  return ws;
}

function bundle(taskId: string): ResearchBundle {
  return {
    taskId,
    query: "内部备忘",
    sources: [],
    claims: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

function draft(over: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "task-persist-1",
    title: "内部备忘",
    summary: "内部核对用",
    sections: [
      { heading: "一", body: "本合同定金为本合同标的额的 30%，双方盖章签署。", citations: [] },
    ],
    reviewStatus: "pending",
    reviewNotes: [],
    output: "docx",
    templateId: "word/contract-default",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("persistDraftPipeline", () => {
  it("flags deposit over cap for lawyer decision, attaches a decision header, and stays pending by default", () => {
    const workspaceDir = tmpWs();
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const next = draft();
    persistDraftPipeline(ctx, next, bundle(next.taskId));
    // 法定参数类不自动改原文：30% 保留，由律师定夺（决策头标记 needs_decision）。
    expect(next.sections[0]?.body).toContain("30%");
    expect(next.decisionHeader).toBeDefined();
    expect(next.decisionHeader?.ready).toBe("needs_decision");
    expect(next.reviewStatus).toBe("pending");
    expect(readDraft(workspaceDir, next.taskId)?.sections[0]?.body).toContain("30%");
  });

  it("never auto-delivers outbound letters even when autonomy is unlocked", () => {
    const workspaceDir = tmpWs();
    for (let i = 0; i < 20; i += 1) {
      appendProductMetric(workspaceDir, { kind: "first_pass", outcome: "ok" });
    }
    appendProductMetric(workspaceDir, { kind: "lint_escape", outcome: "lawyer_edit" });
    appendProductMetric(workspaceDir, { kind: "lint_escape", outcome: "lawyer_edit" });
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const next = draft({
      audience: "客户",
      deliverableType: "letter.demand",
      sections: [{ heading: "一", body: "双方盖章签署。内部核对用备忘正文。", citations: [] }],
    });
    persistDraftPipeline(ctx, next, bundle(next.taskId));
    expect(next.reviewStatus).toBe("pending");
    expect(next.reviewedBy).toBeUndefined();
  });

  it("auto-delivers internal low-risk drafts when autonomy is unlocked and lint is clean", () => {
    const workspaceDir = tmpWs();
    for (let i = 0; i < 20; i += 1) {
      appendProductMetric(workspaceDir, { kind: "first_pass", outcome: "ok" });
    }
    appendProductMetric(workspaceDir, { kind: "lint_escape", outcome: "lawyer_edit" });
    appendProductMetric(workspaceDir, { kind: "lint_escape", outcome: "lawyer_edit" });
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const next = draft({
      audience: "本所内部",
      deliverableType: "report.general",
      sections: [{ heading: "一", body: "双方盖章签署。内部核对用备忘正文。", citations: [] }],
    });
    persistDraftPipeline(ctx, next, bundle(next.taskId));
    expect(next.reviewStatus).toBe("approved");
    expect(next.reviewedBy).toBe("system:auto_deliver");
    expect(next.decisionHeader?.ready).toBe("usable");
  });

  it("does not auto-deliver when the decision header still says 需定夺", () => {
    const workspaceDir = tmpWs();
    for (let i = 0; i < 20; i += 1) {
      appendProductMetric(workspaceDir, { kind: "first_pass", outcome: "ok" });
    }
    appendProductMetric(workspaceDir, { kind: "lint_escape", outcome: "lawyer_edit" });
    appendProductMetric(workspaceDir, { kind: "lint_escape", outcome: "lawyer_edit" });
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const next = draft({
      audience: "本所内部",
      deliverableType: "report.general",
      sections: [{ heading: "一", body: "本合同甲方为【待补充】，双方盖章签署。", citations: [] }],
    });
    persistDraftPipeline(ctx, next, bundle(next.taskId));
    expect(next.decisionHeader?.ready).toBe("needs_decision");
    expect(next.reviewStatus).toBe("pending");
  });

  it("attaches the workspace playbook verdict to contract drafts", () => {
    const workspaceDir = tmpWs();
    saveWorkspacePlaybook(workspaceDir, {
      id: "prc.contract.general",
      name: "中国法合同审查（通用）",
      jurisdiction: "PRC",
      version: "1.0.0",
      stance: "偏委托方",
      acceptableRange: "责任上限不低于合同金额。",
      escalationTriggers: [],
      criteria: [
        {
          id: "dispute_clause",
          kind: "green",
          title: "有争议解决条款",
          check: { kind: "clause_present" },
          clauseTypes: ["dispute"],
        },
      ],
    });
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const next = draft({
      deliverableType: "contract.general",
      sections: [
        {
          heading: "一",
          body: "第一条 争议解决\n因本合同引起的争议，提交北京仲裁委员会仲裁。",
          citations: [],
        },
      ],
    });
    persistDraftPipeline(ctx, next, bundle(next.taskId));
    expect(next.decisionHeader?.playbook).toMatchObject({
      verdict: "GREEN",
      basis: "playbook",
      playbookName: "中国法合同审查（通用）",
      counts: { pass: 1, flag: 0, fail: 0 },
    });
    expect(readDraft(workspaceDir, next.taskId)?.decisionHeader?.playbook?.verdict).toBe("GREEN");
  });

  it("caps contract drafts below auto-deliver when the playbook has unchecked conditions", () => {
    const workspaceDir = tmpWs();
    for (let i = 0; i < 20; i += 1) {
      appendProductMetric(workspaceDir, { kind: "first_pass", outcome: "ok" });
    }
    appendProductMetric(workspaceDir, { kind: "lint_escape", outcome: "lawyer_edit" });
    appendProductMetric(workspaceDir, { kind: "lint_escape", outcome: "lawyer_edit" });
    saveWorkspacePlaybook(workspaceDir, {
      id: "prc.contract.general",
      name: "中国法合同审查（通用）",
      jurisdiction: "PRC",
      version: "1.0.0",
      stance: "偏委托方",
      acceptableRange: "",
      escalationTriggers: [],
      criteria: [{ id: "liability_cap", kind: "green", title: "责任有上限" }],
    });
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const next = draft({
      audience: "本所内部",
      deliverableType: "contract.general",
      sections: [{ heading: "一", body: "双方盖章签署。内部核对用合同正文。", citations: [] }],
    });
    persistDraftPipeline(ctx, next, bundle(next.taskId));
    // 人工条件未给结论 → YELLOW → needs_decision，自动交付不成立。
    expect(next.decisionHeader?.playbook?.verdict).toBe("YELLOW");
    expect(next.decisionHeader?.ready).toBe("needs_decision");
    expect(next.reviewStatus).toBe("pending");
    expect(next.reviewedBy).toBeUndefined();
  });

  it("does not attach a playbook verdict to non-contract deliverables", () => {
    const workspaceDir = tmpWs();
    saveWorkspacePlaybook(workspaceDir, {
      id: "prc.contract.general",
      name: "中国法合同审查（通用）",
      jurisdiction: "PRC",
      version: "1.0.0",
      stance: "",
      acceptableRange: "",
      escalationTriggers: [],
      criteria: [{ id: "liability_cap", kind: "green", title: "责任有上限" }],
    });
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const next = draft({
      deliverableType: "report.general",
      sections: [{ heading: "一", body: "双方盖章签署。内部核对用备忘正文。", citations: [] }],
    });
    persistDraftPipeline(ctx, next, bundle(next.taskId));
    expect(next.decisionHeader?.playbook).toBeUndefined();
  });
});
