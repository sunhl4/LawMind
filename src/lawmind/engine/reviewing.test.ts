/**
 * Engine reviewing — unit tests for reviewDraft side effects.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readDeliverable } from "../application/services/deliverable-service.js";
import { checkTaskDraftConsistency } from "../application/task-draft-consistency.js";
import { readAllAuditLogs } from "../audit/index.js";
import { persistDraft, readDraft } from "../drafts/index.js";
import { loadAgentSpecializationStore } from "../learning/agent-specialization.js";
import { listPendingMemorySuggestions } from "../memory/adoption-service.js";
import { listProductMetricEvents, summarizeProductMetrics } from "../metrics/product-metrics.js";
import { ensureTaskRecord } from "../tasks/index.js";
import type { ArtifactDraft } from "../types.js";
import { buildEngineContext } from "./context.js";
import { recordLintEscape, reviewDraft } from "./reviewing.js";

describe("engine/reviewing", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-reviewing-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "cases", "matter-r"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "cases", "matter-r", "CASE.md"), "# Case\n", "utf8");
  });

  afterEach(async () => {
    // createMatterIfMissing → scheduleMatterProjection may still write CASE.md after
    // reviewDraft returns; retry so async projection cannot trip ENOTEMPTY on macOS.
    await fs.rm(workspaceDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("reviewDraft sets approved status and emits draft.reviewed audit", async () => {
    const taskId = "task-review-1";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Review test",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);

    const ctx = buildEngineContext({
      workspaceDir,
      adapters: [],
    });
    const { draft: reviewed, matterWriteFailed } = await reviewDraft(ctx, draft, {
      actorId: "lawyer:test",
      status: "approved",
      note: "LGTM",
    });

    expect(matterWriteFailed).toBe(false);
    expect(reviewed.reviewStatus).toBe("approved");
    expect(reviewed.reviewedBy).toBe("lawyer:test");
    const events = await readAllAuditLogs(path.join(workspaceDir, "audit"));
    expect(events.some((e) => e.kind === "draft.reviewed" && e.taskId === taskId)).toBe(true);
  });

  it("records specialization + product metrics on first-pass approve", async () => {
    const taskId = "task-review-metrics";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Metrics",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [], assistantId: "asst_a" });
    await reviewDraft(ctx, draft, { status: "approved", assistantId: "asst_a" });
    const store = loadAgentSpecializationStore(workspaceDir);
    expect(store.byAssistant.asst_a?.firstPassApprovals).toBe(1);
    const metrics = summarizeProductMetrics(workspaceDir);
    expect(metrics.firstPassOk).toBe(1);
    expect(metrics.rewrites).toBe(0);
  });

  it("modified with note creates pending adoptions and rewrite metric", async () => {
    const taskId = "task-review-modified";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Mod",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [], assistantId: "asst_b" });
    await reviewDraft(ctx, draft, {
      status: "modified",
      note: "管辖条款必须单列",
      assistantId: "asst_b",
    });
    const metrics = summarizeProductMetrics(workspaceDir);
    expect(metrics.rewrites).toBe(1);
    const pending = await listPendingMemorySuggestions(workspaceDir);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.some((r) => r.sourceTaskId === taskId)).toBe(true);
  });

  it("reviewDraft stamps deliverable JSON before draft persist (R-P2-7 SSOT)", async () => {
    const taskId = "task-review-ssot";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "SSOT review",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    await reviewDraft(ctx, draft, { actorId: "lawyer:test", status: "approved" });

    const deliverable = readDeliverable(workspaceDir, "matter-r", taskId);
    expect(deliverable?.currentReviewStatus).toBe("approved");
    expect(readDraft(workspaceDir, taskId)?.reviewStatus).toBe("approved");
    const drift = checkTaskDraftConsistency(workspaceDir).filter(
      (i) => i.code === "deliverable_review_drift",
    );
    expect(drift).toEqual([]);
  });

  it("reopenDraftReviewImpl restores pending and opens review queue", async () => {
    const taskId = "task-reopen";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Reopen",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "approved",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
      reviewedBy: "lawyer:test",
      reviewedAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const { reopenDraftReviewImpl } = await import("./reviewing.js");
    const reopened = await reopenDraftReviewImpl(ctx, taskId, { actorId: "lawyer:test" });
    expect(reopened?.reviewStatus).toBe("pending");
    expect(reopened?.reviewedBy).toBeUndefined();
    const events = await readAllAuditLogs(path.join(workspaceDir, "audit"));
    expect(events.some((e) => e.kind === "draft.review_reopened")).toBe(true);
  });

  it("reopenDraftReviewImpl symmetrically rewrites deliverable stamp (no dual-truth drift)", async () => {
    const taskId = "task-reopen-ssot";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Reopen SSOT",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    await reviewDraft(ctx, draft, { actorId: "lawyer:test", status: "approved" });
    const approvedDeliverable = readDeliverable(workspaceDir, "matter-r", taskId);
    expect(approvedDeliverable?.currentReviewStatus).toBe("approved");
    expect(approvedDeliverable?.status).toBe("approved");

    const { reopenDraftReviewImpl } = await import("./reviewing.js");
    const reopened = await reopenDraftReviewImpl(ctx, taskId, { actorId: "lawyer:test" });
    expect(reopened?.reviewStatus).toBe("pending");

    const deliverable = readDeliverable(workspaceDir, "matter-r", taskId);
    expect(deliverable?.currentReviewStatus).toBe("pending");
    expect(deliverable?.status).toBe("pending_review");
    expect(deliverable?.approvedBy).toBeUndefined();
    expect(readDraft(workspaceDir, taskId)?.reviewStatus).toBe("pending");
    const drift = checkTaskDraftConsistency(workspaceDir).filter(
      (i) => i.code === "deliverable_review_drift",
    );
    expect(drift).toEqual([]);

    // 重开后可再次走完整签批：pending_review → approved 合法。
    const again = readDraft(workspaceDir, taskId)!;
    await reviewDraft(ctx, again, { actorId: "lawyer:test", status: "approved" });
    expect(readDeliverable(workspaceDir, "matter-r", taskId)?.currentReviewStatus).toBe("approved");
  });

  it("recordQualityImpl persists quality snapshot with metrics", async () => {
    const taskId = "task-quality";
    const now = new Date().toISOString();
    persistDraft(workspaceDir, {
      taskId,
      matterId: "matter-r",
      title: "Quality",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "approved",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: now,
    });
    ensureTaskRecord(workspaceDir, {
      taskId,
      kind: "draft.word",
      output: "docx",
      instruction: "写备忘",
      summary: "写备忘",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: now,
      deliverableType: "document.general",
    });
    const ctx = buildEngineContext({ workspaceDir, adapters: [], assistantId: "asst_a" });
    const { recordQualityImpl } = await import("./reviewing.js");
    const record = await recordQualityImpl(ctx, taskId, { labels: ["质量范例"], latencyMs: 900 });
    expect(record?.firstPassApproved).toBe(true);
    expect(record?.isGoldenExample).toBe(true);
    const events = await readAllAuditLogs(path.join(workspaceDir, "audit"));
    expect(events.some((e) => e.kind === "quality.snapshot")).toBe(true);
  });

  it("reviewDraft records modified status and review note", async () => {
    const taskId = "task-modified";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Needs edits",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const { draft: reviewed } = await reviewDraft(ctx, draft, {
      actorId: "lawyer:test",
      status: "modified",
      note: "请补充引用",
    });
    expect(reviewed.reviewStatus).toBe("modified");
    expect(reviewed.reviewNotes.some((n) => n.includes("请补充引用"))).toBe(true);
  });

  it("reviewDraft records rejected status", async () => {
    const taskId = "task-rejected";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Reject me",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const { draft: reviewed } = await reviewDraft(ctx, draft, {
      actorId: "lawyer:test",
      status: "rejected",
      note: "方向不对",
    });
    expect(reviewed.reviewStatus).toBe("rejected");
  });

  it("reports matterWriteFailed when deliverable stamp cannot be written", async () => {
    await fs.writeFile(path.join(workspaceDir, "matters"), "blocked", "utf8");
    const taskId = "task-review-stamp-fail";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Stamp fail",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const result = await reviewDraft(ctx, draft, { actorId: "lawyer:test", status: "approved" });
    expect(result.matterWriteFailed).toBe(true);
    expect(result.draft.reviewStatus).toBe("approved");
  });

  it("records review_duration on approve when createdAt and reviewedAt are finite", async () => {
    const taskId = "task-review-duration";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Duration",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: "2026-01-01T00:00:00.000Z",
      reviewedAt: "2026-01-01T00:10:00.000Z",
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    await reviewDraft(ctx, draft, { actorId: "lawyer:test", status: "approved" });
    const events = listProductMetricEvents(workspaceDir);
    const duration = events.find((e) => e.kind === "review_duration");
    expect(duration?.outcome).toBe("ok");
    expect(duration?.meta?.durationMs).toBe(600_000);
  });

  it("records lint_escape on modify when draft text still trips lint", async () => {
    const taskId = "task-review-lint-escape";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Escape",
      summary: "定金条款",
      sections: [{ heading: "定金", body: "定金为本合同标的额的 30%。", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    await reviewDraft(ctx, draft, { actorId: "lawyer:test", status: "modified", note: "改定金" });
    expect(summarizeProductMetrics(workspaceDir).byKind.lint_escape).toBe(1);
  });

  it("records lint_escape on approve when rewriteAmplitude delta > 0", async () => {
    const taskId = "task-review-rewrite-escape";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Rewritten",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
      rewriteAmplitude: {
        absCharDelta: 12,
        absParagraphDelta: 1,
        at: new Date().toISOString(),
      },
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    await reviewDraft(ctx, draft, { actorId: "lawyer:test", status: "approved" });
    expect(summarizeProductMetrics(workspaceDir).byKind.lint_escape).toBe(1);
  });

  it("recordLintEscape no-ops on clean text unless lawyerEdited", () => {
    const draft: ArtifactDraft = {
      taskId: "task-escape-direct",
      title: "Clean",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    expect(recordLintEscape(workspaceDir, draft)).toBe(false);
    expect(summarizeProductMetrics(workspaceDir).byKind.lint_escape).toBeUndefined();
    expect(recordLintEscape(workspaceDir, draft, { lawyerEdited: true })).toBe(true);
    expect(summarizeProductMetrics(workspaceDir).byKind.lint_escape).toBe(1);
  });
});
