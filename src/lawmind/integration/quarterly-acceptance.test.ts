/**
 * Quarterly acceptance — W12.
 *
 * 端到端联动 W3 (write services) + W4 (engine wires services) + W5
 * (memory adoption) + W7 (Role) + W9 (reasoning gate)：
 *
 *   1. 创建 matter；新建 deliverable / queue / approval 三类 JSON 真相源。
 *   2. 触发 reviewer flow，使 deliverable 状态翻 reviewed、queue 关闭。
 *   3. 校验 reasoning gate 在 strict 模式下能阻断渲染（无 reasoning snapshot）。
 *   4. 校验 memory adoption 服务可写入并按 scope 列出。
 *
 * 这是 LawMind 12-周架构改造的一站式回归点；季末若新增 sunset 字段，
 * 在此处补充用例后再切。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadDeliverable,
  loadMatter,
  readApprovals,
  readQueueItems,
} from "../adapters/matter-storage/index.js";
import { resolveApproval, requestApproval } from "../application/services/approval-service.js";
import {
  createPlannedDeliverable,
  transitionDeliverable,
} from "../application/services/deliverable-service.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { openQueueItem, transitionQueueItem } from "../application/services/queue-write-service.js";
import { getRoleById, listRoles, roleAllowsDeliverable } from "../core/role.js";
import { validateReasoningAgainstSpec } from "../deliverables/index.js";
import { listMemorySuggestions, suggestMemoryAdoption } from "../memory/adoption-service.js";
import { caseFilePath } from "../memory/index.js";

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-q-acc-"));
}

describe("Quarterly acceptance (W3 + W4 + W5 + W7 + W9)", () => {
  let ws: string;

  afterEach(() => {
    if (ws) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("write services persist matter / deliverable / queue / approval", async () => {
    ws = tmpWorkspace();
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const matterId = "q-acc-1";
    createMatterIfMissing(ws, { matterId, title: "季末验收案件" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fs.existsSync(caseFilePath(ws, matterId))).toBe(true);
    const deliverable = createPlannedDeliverable(ws, {
      matterId,
      deliverableId: "d-1",
      taskId: "t-1",
      kind: "demand-letter",
      audience: "counterparty",
    });
    const queueItem = openQueueItem(ws, {
      matterId,
      kind: "need_lawyer_review",
      title: "草稿待审",
      relatedTaskId: "t-1",
    });
    const approval = requestApproval(ws, {
      matterId,
      deliverableId: "d-1",
      requestedBy: "lawyer-x",
      reason: "高风险律师函，需合伙人复核",
      riskLevel: "high",
      targetRole: "general_default",
    });

    const matterPersisted = loadMatter(ws, matterId);
    expect(matterPersisted?.title).toBe("季末验收案件");
    expect(loadDeliverable(ws, matterId, deliverable.deliverableId)?.kind).toBe("demand-letter");
    expect(readQueueItems(ws, matterId).map((q) => q.queueItemId)).toContain(queueItem.queueItemId);
    expect(readApprovals(ws, matterId).map((a) => a.approvalId)).toContain(approval.approvalId);

    transitionDeliverable(ws, matterId, deliverable.deliverableId, "drafting");
    transitionDeliverable(ws, matterId, deliverable.deliverableId, "pending_review");
    transitionDeliverable(ws, matterId, deliverable.deliverableId, "approved");
    const transitioned = transitionDeliverable(ws, matterId, deliverable.deliverableId, "rendered");
    expect(transitioned?.status).toBe("rendered");
    const queueClosed = transitionQueueItem(ws, matterId, queueItem.queueItemId, "resolved");
    expect(queueClosed?.status).toBe("resolved");
    const approvalResolved = resolveApproval(ws, matterId, approval.approvalId, {
      status: "approved",
      resolvedBy: "lawyer-x",
    });
    expect(approvalResolved).toMatchObject({
      outcome: "written",
      approval: { status: "approved" },
    });
  });

  it("Role first-class wiring constrains deliverable types", () => {
    const allRoles = listRoles();
    expect(allRoles.length).toBeGreaterThan(0);
    const compliance = getRoleById("compliance_research");
    expect(compliance).toBeDefined();
    if (compliance) {
      expect(roleAllowsDeliverable(compliance, "legal-memo")).toBe(true);
      expect(roleAllowsDeliverable(compliance, "litigation-outline")).toBe(false);
    }
  });

  it("Reasoning gate blocks render when high-risk spec lacks supporting graph", () => {
    const report = validateReasoningAgainstSpec(undefined, "litigation.outline");
    expect(report.required).toBe(true);
    expect(report.ready).toBe(false);
    expect(report.checks[0].key).toBe("graph_present");
  });

  it("Memory Adoption Service records suggestions and lists them by scope", async () => {
    ws = tmpWorkspace();
    const auditDir = path.join(ws, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    await suggestMemoryAdoption(ws, auditDir, {
      scope: "matter",
      kind: "case.core_issue",
      payload: "争议焦点：违约金过高的认定",
      sourceTaskId: "t-1",
      targetId: "q-acc-2",
    });
    const all = await listMemorySuggestions(ws, { targetId: "q-acc-2" });
    expect(all.length).toBe(1);
    expect(all[0].scope).toBe("matter");
    expect(all[0].kind).toBe("case.core_issue");
  });
});
