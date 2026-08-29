/**
 * Phase 12 — golden journey structural integration (no LLM).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter, readApprovals, readQueueItems } from "../adapters/matter-storage/index.js";
import { resolveApproval, requestApproval } from "../application/services/approval-service.js";
import {
  createPlannedDeliverable,
  transitionDeliverable,
} from "../application/services/deliverable-service.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { openQueueItem } from "../application/services/queue-write-service.js";
import { getRoleById, roleAllowsDeliverable } from "../core/role.js";
import { validateDraftAgainstSpec } from "../deliverables/validator.js";
import { buildMatterReviewMatrix } from "../matter/review-matrix.js";
import { listMemorySuggestions, suggestMemoryAdoption } from "../memory/adoption-service.js";
import { LAWMIND_Q1_GOLDEN_JOURNEYS } from "../product/golden-journeys.js";
import type { ArtifactDraft } from "../types.js";

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-gj-"));
}

describe("Golden journeys (Phase 12)", () => {
  let ws: string;

  afterEach(() => {
    if (ws) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("defines three Q1 golden journeys", () => {
    expect(LAWMIND_Q1_GOLDEN_JOURNEYS.map((j) => j.id)).toEqual([
      "matter-production-flow",
      "contract-review-trust-flow",
      "role-delegation-memory-flow",
    ]);
  });

  it("matter-production-flow: matter → deliverable → review → rendered", async () => {
    ws = tmpWorkspace();
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const matterId = "gj-matter-1";
    createMatterIfMissing(ws, { matterId, title: "黄金旅程案件" });
    const deliverable = createPlannedDeliverable(ws, {
      matterId,
      deliverableId: "gj-d-1",
      taskId: "gj-task-1",
      kind: "demand-letter",
      audience: "counterparty",
    });
    openQueueItem(ws, {
      matterId,
      kind: "need_lawyer_review",
      title: "待审",
      relatedTaskId: "gj-task-1",
    });
    transitionDeliverable(ws, matterId, deliverable.deliverableId, "drafting");
    transitionDeliverable(ws, matterId, deliverable.deliverableId, "pending_review");
    transitionDeliverable(ws, matterId, deliverable.deliverableId, "approved");
    const rendered = transitionDeliverable(ws, matterId, deliverable.deliverableId, "rendered");
    expect(rendered?.status).toBe("rendered");
    expect(loadMatter(ws, matterId)?.deliverableIds).toContain(deliverable.deliverableId);
    expect(readQueueItems(ws, matterId).length).toBeGreaterThan(0);
  });

  it("contract-review-trust-flow: review matrix + acceptance gate on contract draft", async () => {
    ws = tmpWorkspace();
    fs.mkdirSync(path.join(ws, "drafts"), { recursive: true });
    fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
    fs.mkdirSync(path.join(ws, "cases", "gj-contract-1"), { recursive: true });
    const matterId = "gj-contract-1";
    const taskId = "gj-contract-task";
    const draft: ArtifactDraft = {
      taskId,
      title: "合同审查",
      summary: "违约金 风险 修改建议",
      output: "docx",
      deliverableType: "contract.review",
      reviewStatus: "pending",
      reviewNotes: [],
      matterId,
      sections: [
        { heading: "风险摘要", body: "违约金条款存在风险，建议修改。" },
        { heading: "来源", body: "msa.docx" },
      ],
      sourceReferences: [{ sourceId: "s1", label: "msa.docx", excerpt: "违约金条款" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(ws, "drafts", `${taskId}.json`),
      JSON.stringify(draft, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(ws, "tasks", `${taskId}.json`),
      JSON.stringify(
        {
          taskId,
          matterId,
          kind: "analyze.contract",
          status: "completed",
          instruction: "审查合同",
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt,
        },
        null,
        2,
      ),
      "utf8",
    );
    const matrix = buildMatterReviewMatrix(ws, matterId);
    expect(matrix.matterId).toBe(matterId);
    expect(matrix.documents.length).toBeGreaterThan(0);
    const acceptance = validateDraftAgainstSpec(draft, "contract.review", { strict: false });
    expect(acceptance.deliverableType).toBe("contract.review");
    expect(acceptance.checks.length).toBeGreaterThan(0);
  });

  it("role-delegation-memory-flow: role constraints + approval targetRole + memory adoption queue", async () => {
    ws = tmpWorkspace();
    const auditDir = path.join(ws, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    const compliance = getRoleById("compliance_research");
    expect(compliance).toBeDefined();
    if (compliance) {
      expect(roleAllowsDeliverable(compliance, "legal-memo")).toBe(true);
    }
    const matterId = "gj-role-1";
    createMatterIfMissing(ws, { matterId, title: "委派案件" });
    const approval = requestApproval(ws, {
      matterId,
      deliverableId: "gj-d-role",
      requestedBy: "associate-1",
      reason: "需合规岗复核",
      riskLevel: "high",
      targetRole: "compliance_research",
    });
    expect(approval.targetRole).toBe("compliance_research");
    const resolved = resolveApproval(ws, matterId, approval.approvalId, {
      status: "approved",
      resolvedBy: "partner-1",
    });
    expect(resolved).toMatchObject({
      outcome: "written",
      approval: { status: "approved" },
    });
    expect(readApprovals(ws, matterId).length).toBe(1);
    await suggestMemoryAdoption(ws, auditDir, {
      scope: "matter",
      kind: "case.core_issue",
      payload: "委派学习：合规审查要点",
      sourceTaskId: "gj-task-role",
      targetId: matterId,
    });
    const pending = await listMemorySuggestions(ws, { state: "pending", scope: "matter" });
    expect(pending.length).toBe(1);
    expect(pending[0].state).toBe("pending");
  });
});
