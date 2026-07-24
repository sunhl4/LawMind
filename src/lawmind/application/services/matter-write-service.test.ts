/**
 * W3 — write-side application services smoke tests.
 *
 * 验证：
 *   - createMatterIfMissing 幂等
 *   - createPlannedDeliverable + linkDraftToDeliverable 双轨写入
 *   - requestApproval / resolveApproval 闭环
 *   - openQueueItem / transitionQueueItem 闭环
 *   - recordDeadline / completeDeadline 闭环
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadMatter,
  readApprovals,
  readDeadlines,
  readQueueItems,
  loadDeliverable,
} from "../../adapters/matter-storage/index.js";
import { parseMatterDisplayNameFromCase } from "../../cases/matter-label.js";
import { caseFilePath } from "../../memory/index.js";
import type { ArtifactDraft } from "../../types.js";
import { listPendingApprovals, requestApproval, resolveApproval } from "./approval-service.js";
import { completeDeadline, recordDeadline } from "./deadline-service.js";
import {
  createPlannedDeliverable,
  linkDraftToDeliverable,
  transitionDeliverable,
} from "./deliverable-service.js";
import {
  createMatterIfMissing,
  setMatterStrategy,
  updateMatterStatus,
} from "./matter-write-service.js";
import { openQueueItem, transitionQueueItem } from "./queue-write-service.js";

describe("Matter write services (W3)", () => {
  let workspaceDir: string;
  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "matter-svc-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  });
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    await fs.rm(workspaceDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("createMatterIfMissing schedules CASE.md projection", async () => {
    createMatterIfMissing(workspaceDir, { matterId: "m-dual", title: "Dual Write" });
    const casePath = caseFilePath(workspaceDir, "m-dual");
    let raw = "";
    for (let i = 0; i < 40; i++) {
      try {
        raw = await fs.readFile(casePath, "utf8");
        if (parseMatterDisplayNameFromCase(raw) === "Dual Write") {
          break;
        }
      } catch {
        /* not written yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(parseMatterDisplayNameFromCase(raw)).toBe("Dual Write");
  });

  it("createMatterIfMissing is idempotent and persists JSON truth source", () => {
    const a = createMatterIfMissing(workspaceDir, { matterId: "m-1", title: "Test Matter" });
    const b = createMatterIfMissing(workspaceDir, { matterId: "m-1", title: "Different" });
    expect(a.matterId).toBe("m-1");
    expect(b.matterId).toBe("m-1");
    expect(b.title).toBe("Test Matter");
    const loaded = loadMatter(workspaceDir, "m-1");
    expect(loaded?.matterId).toBe("m-1");
    expect(loaded?.strategyStatus).toBe("draft");
  });

  it("updateMatterStatus and setMatterStrategy mutate the truth source", () => {
    createMatterIfMissing(workspaceDir, { matterId: "m-2" });
    updateMatterStatus(workspaceDir, "m-2", "active");
    setMatterStrategy(workspaceDir, "m-2", "approved", { nextActions: ["draft answer"] });
    const loaded = loadMatter(workspaceDir, "m-2");
    expect(loaded?.status).toBe("active");
    expect(loaded?.strategyStatus).toBe("approved");
    expect(loaded?.nextActions).toContain("draft answer");
  });

  it("createPlannedDeliverable + transitionDeliverable round-trip", () => {
    const created = createPlannedDeliverable(workspaceDir, {
      matterId: "m-3",
      deliverableId: "d-3",
      kind: "demand-letter",
      audience: "client",
    });
    expect(created.status).toBe("planned");
    const updated = transitionDeliverable(workspaceDir, "m-3", "d-3", "drafting");
    expect(updated?.status).toBe("drafting");
    const loaded = loadDeliverable(workspaceDir, "m-3", "d-3");
    expect(loaded?.status).toBe("drafting");
    const matter = loadMatter(workspaceDir, "m-3");
    expect(matter?.deliverableIds).toContain("d-3");
  });

  it("linkDraftToDeliverable mirrors ArtifactDraft into JSON truth source", () => {
    const draft: ArtifactDraft = {
      taskId: "task-99",
      matterId: "m-4",
      title: "Draft",
      output: "docx",
      templateId: "word/demand-letter-default",
      summary: "summary",
      sections: [{ heading: "Intro", body: "..." }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    const record = linkDraftToDeliverable(workspaceDir, draft);
    expect(record?.deliverableId).toBe("task-99");
    expect(record?.status).toBe("pending_review");
  });

  it("requestApproval + resolveApproval transitions correctly", () => {
    const req = requestApproval(workspaceDir, {
      matterId: "m-5",
      requestedBy: "lawyer:alice",
      requestedRole: "research",
      targetRole: "supervising-partner",
      reason: "high-risk",
      riskLevel: "high",
    });
    expect(req.status).toBe("pending");
    const pending = listPendingApprovals(workspaceDir, "m-5", {
      targetRole: "supervising-partner",
    });
    expect(pending.length).toBe(1);
    const resolved = resolveApproval(workspaceDir, "m-5", req.approvalId, {
      status: "approved",
      resolvedBy: "lawyer:partner",
    });
    expect(resolved?.status).toBe("approved");
    const all = readApprovals(workspaceDir, "m-5");
    expect(all[0].status).toBe("approved");
  });

  it("openQueueItem + transitionQueueItem appends and updates JSONL", () => {
    const opened = openQueueItem(workspaceDir, {
      matterId: "m-6",
      kind: "need_lawyer_review",
      title: "Draft pending",
      priority: "high",
    });
    expect(opened.status).toBe("open");
    transitionQueueItem(workspaceDir, "m-6", opened.queueItemId, "resolved");
    const items = readQueueItems(workspaceDir, "m-6");
    expect(items[0].status).toBe("resolved");
  });

  it("openQueueItem sets blockedReason when dependsOn is unresolved", () => {
    const first = openQueueItem(workspaceDir, {
      matterId: "m-6b",
      kind: "need_lawyer_review",
      title: "First",
    });
    const second = openQueueItem(workspaceDir, {
      matterId: "m-6b",
      kind: "need_lawyer_review",
      title: "Second",
      dependsOn: [first.queueItemId],
    });
    expect(second.blockedReason).toContain("等待前置待办");
    transitionQueueItem(workspaceDir, "m-6b", first.queueItemId, "resolved");
    const reopened = openQueueItem(workspaceDir, {
      matterId: "m-6b",
      kind: "need_lawyer_review",
      title: "Third",
      dependsOn: [first.queueItemId],
    });
    expect(reopened.blockedReason).toBeUndefined();
  });

  it("recordDeadline + completeDeadline appends and updates JSONL", () => {
    const recorded = recordDeadline(workspaceDir, {
      matterId: "m-7",
      title: "Filing deadline",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      severity: "hard",
    });
    expect(recorded.status).toBe("open");
    completeDeadline(workspaceDir, "m-7", recorded.deadlineId);
    const all = readDeadlines(workspaceDir, "m-7");
    expect(all[0].status).toBe("completed");
  });
});
