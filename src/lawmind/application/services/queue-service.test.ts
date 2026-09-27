import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeTestWorkspaceDir } from "../../../../test/lawmind-workspace-cleanup.js";
import {
  listMatterIdsFromStorage,
  readApprovals,
  readQueueItems,
  appendApproval,
  appendQueueItem,
} from "../../adapters/matter-storage/index.js";
import { buildMatterIndex, listMatterIds } from "../../cases/index.js";
import {
  buildApprovalRequestsFromMatterIndex,
  buildQueueItemsFromMatterIndex,
} from "../../core/contracts.js";
import {
  createLawMindEngine,
  createLegalModelAdapter,
  createWorkspaceAdapter,
  listApprovalRequests,
  listWorkQueueItems,
} from "../../index.js";
import { caseFilePath } from "../../memory/index.js";
import { requestApproval, resolveApproval } from "./approval-service.js";
import { openQueueItem, transitionQueueItem } from "./queue-write-service.js";

function mergeUniqueById<T>(primary: T[], secondary: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...primary, ...secondary]) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

async function legacyListApprovals(workspaceDir: string, matterId?: string) {
  const matterIds = matterId
    ? [matterId]
    : Array.from(
        new Set([
          ...listMatterIdsFromStorage(workspaceDir),
          ...(await listMatterIds(workspaceDir)),
        ]),
      );
  const all = (
    await Promise.all(
      matterIds.map(async (id) => {
        const stored = readApprovals(workspaceDir, id);
        const index = await buildMatterIndex(workspaceDir, id);
        return mergeUniqueById(
          stored,
          buildApprovalRequestsFromMatterIndex(index),
          (a) => a.approvalId,
        );
      }),
    )
  ).flat();
  return all.toSorted((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

async function legacyListQueue(workspaceDir: string, matterId?: string) {
  const matterIds = matterId
    ? [matterId]
    : Array.from(
        new Set([
          ...listMatterIdsFromStorage(workspaceDir),
          ...(await listMatterIds(workspaceDir)),
        ]),
      );
  const all = (
    await Promise.all(
      matterIds.map(async (id) => {
        const stored = readQueueItems(workspaceDir, id);
        const index = await buildMatterIndex(workspaceDir, id);
        return mergeUniqueById(stored, buildQueueItemsFromMatterIndex(index), (q) => q.queueItemId);
      }),
    )
  ).flat();
  return all.toSorted((a, b) => {
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (byPriority !== 0) {
      return byPriority;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

describe("LawMind queue service", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-queue-service-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Global memory", "utf8");
    await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer profile", "utf8");
  });

  afterEach(async () => {
    await removeTestWorkspaceDir(workspaceDir);
  });

  it("lists pending approval requests for high-risk planned work", async () => {
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir)],
    });

    engine.plan("写一封催款律师函", { matterId: "matter-queue-1" });
    const approvals = await listApprovalRequests(workspaceDir, {
      matterId: "matter-queue-1",
      status: "pending",
    });

    expect(approvals.some((item) => item.approvalId.endsWith(":task-confirmation"))).toBe(true);
  });

  it("lists queue items for pending review and evidence gaps", async () => {
    const mockLegal = createLegalModelAdapter(async () => ({
      claims: [{ text: "违约责任具备初步成立基础。", confidence: 0.88 }],
      sources: [{ title: "合同争议规则", citation: "内部规则" }],
      riskFlags: ["通知送达证据仍待补充"],
    }));

    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockLegal],
    });

    const intent = engine.plan("审查合同争议并输出律师意见", {
      matterId: "matter-queue-2",
      templateId: "word/legal-memo-default",
    });
    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const bundle = await engine.research(intent);
    engine.draft(intent, bundle, { title: "待审核法律意见" });

    const queueItems = await listWorkQueueItems(workspaceDir, { matterId: "matter-queue-2" });
    expect(queueItems.some((item) => item.kind === "need_lawyer_review")).toBe(true);
    expect(queueItems.some((item) => item.kind === "need_evidence")).toBe(true);
  });

  it("matches legacy buildMatterIndex merge for approvals and queue (parity)", async () => {
    const matterId = "parity-matter";
    const mockLegal = createLegalModelAdapter(async () => ({
      claims: [{ text: "具备初步请求权基础。", confidence: 0.9 }],
      sources: [{ title: "内部规则", citation: "内部" }],
      riskFlags: ["关键证据仍待补充"],
    }));
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir), mockLegal],
    });
    const intent = engine.plan("写法律意见并标注缺口", {
      matterId,
      templateId: "word/legal-memo-default",
    });
    await engine.confirm(intent.taskId, { actorId: "lawyer:test" });
    const bundle = await engine.research(intent);
    engine.draft(intent, bundle, { title: "对拍草稿" });

    // JSON 真相源覆盖同 id 派生项：列表必须以存储为准。
    appendApproval(workspaceDir, {
      approvalId: `${intent.taskId}:draft-review`,
      matterId,
      deliverableId: intent.taskId,
      requestedBy: "lawyer:stored",
      requestedRole: "reviewing-lawyer",
      requestedAt: "2026-01-01T00:00:00.000Z",
      reason: "stored wins",
      riskLevel: "high",
      status: "pending",
    });
    appendQueueItem(workspaceDir, {
      queueItemId: `${matterId}:client`,
      matterId,
      kind: "need_client_input",
      status: "open",
      priority: "critical",
      title: "请客户补材料",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const [leanApprovals, legacyApprovals, leanQueue, legacyQueue] = await Promise.all([
      listApprovalRequests(workspaceDir, { matterId }),
      legacyListApprovals(workspaceDir, matterId),
      listWorkQueueItems(workspaceDir, { matterId }),
      legacyListQueue(workspaceDir, matterId),
    ]);

    expect(leanApprovals).toEqual(legacyApprovals);
    expect(leanQueue).toEqual(legacyQueue);
    expect(leanApprovals.find((a) => a.approvalId.endsWith(":draft-review"))?.reason).toBe(
      "stored wins",
    );
    expect(leanQueue.some((q) => q.queueItemId === `${matterId}:client`)).toBe(true);
  });

  it("does not call buildMatterIndex on the list path", async () => {
    const spy = vi.spyOn(await import("../../cases/index.js"), "buildMatterIndex");
    const engine = createLawMindEngine({
      workspaceDir,
      adapters: [createWorkspaceAdapter(workspaceDir)],
    });
    engine.plan("催款函", { matterId: "no-index-matter" });
    spy.mockClear();

    await listApprovalRequests(workspaceDir, { matterId: "no-index-matter" });
    await listWorkQueueItems(workspaceDir, { matterId: "no-index-matter" });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("sees writes immediately after approval and queue mutations", async () => {
    const matterId = "write-through-matter";
    await fs.mkdir(path.dirname(caseFilePath(workspaceDir, matterId)), { recursive: true });
    await fs.writeFile(
      caseFilePath(workspaceDir, matterId),
      "# CASE\n\n## 1. 基本信息\n\n- 名称：写穿\n",
      "utf8",
    );

    const created = requestApproval(workspaceDir, {
      matterId,
      requestedBy: "lawyer:a",
      reason: "外发前确认",
      riskLevel: "high",
    });
    const pending = await listApprovalRequests(workspaceDir, { matterId, status: "pending" });
    expect(pending.some((a) => a.approvalId === created.approvalId)).toBe(true);

    const resolved = resolveApproval(workspaceDir, matterId, created.approvalId, {
      status: "approved",
      resolvedBy: "lawyer:a",
    });
    expect(resolved.outcome).toBe("written");
    const afterResolve = await listApprovalRequests(workspaceDir, {
      matterId,
      status: "pending",
    });
    expect(afterResolve.some((a) => a.approvalId === created.approvalId)).toBe(false);

    const opened = openQueueItem(workspaceDir, {
      matterId,
      kind: "need_client_input",
      title: "问客户一句",
      priority: "high",
    });
    const openItems = await listWorkQueueItems(workspaceDir, { matterId, status: "open" });
    expect(openItems.some((q) => q.queueItemId === opened.queueItemId)).toBe(true);

    transitionQueueItem(workspaceDir, matterId, opened.queueItemId, "resolved");
    const afterTransition = await listWorkQueueItems(workspaceDir, {
      matterId,
      status: "open",
    });
    expect(afterTransition.some((q) => q.queueItemId === opened.queueItemId)).toBe(false);
  });
});
