/**
 * LawMind 12-周架构改造端到端 demo —— W12。
 *
 * 完全走新真相源（matter/deliverable/queue/approval JSON + memory adoption），
 * 不依赖任何旧 fallback。本脚本用于：
 *   1. `pnpm lawmind:acceptance` 季末验收链中"新链路一次跑通"的最小化证据。
 *   2. 录制 5–10 分钟 demo 视频时的"剧本骨架"——配合 desktop 跑现场即可。
 *
 * 执行：
 *   pnpm lawmind:quarterly-demo
 *
 * 默认会在系统 tmp 目录下建一次性 workspace（脚本结束时自动删除）。如想保留以人工
 * 检查产物，传 `--keep-workspace`。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadDeliverable,
  loadMatter,
  readApprovals,
  readQueueItems,
} from "../../src/lawmind/adapters/matter-storage/index.js";
import {
  resolveApproval,
  requestApproval,
} from "../../src/lawmind/application/services/approval-service.js";
import {
  createPlannedDeliverable,
  transitionDeliverable,
} from "../../src/lawmind/application/services/deliverable-service.js";
import { createMatterIfMissing } from "../../src/lawmind/application/services/matter-write-service.js";
import {
  openQueueItem,
  transitionQueueItem,
} from "../../src/lawmind/application/services/queue-write-service.js";
import { getRoleById, listRoles, roleAllowsDeliverable } from "../../src/lawmind/core/role.js";
import { validateReasoningAgainstSpec } from "../../src/lawmind/deliverables/index.js";
import {
  flushQualityDashboard,
  seedQualitySnapshot,
} from "../../src/lawmind/evaluation/quality-seed.js";
import {
  listMemorySuggestions,
  suggestMemoryAdoption,
} from "../../src/lawmind/memory/adoption-service.js";

type Options = {
  keepWorkspace: boolean;
};

function parseArgs(argv: string[]): Options {
  return {
    keepWorkspace: argv.includes("--keep-workspace"),
  };
}

function step(label: string): void {
  console.log(`\n[Quarterly Demo] ${label}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-q12-"));
  const auditDir = path.join(ws, "audit");
  fs.mkdirSync(auditDir, { recursive: true });
  console.log(`[Quarterly Demo] workspace=${ws}`);

  try {
    step("1/7 W7 Role 一等对象：列出内置岗位并校验 deliverable 约束");
    const roles = listRoles();
    if (roles.length === 0) {
      throw new Error("no built-in roles found");
    }
    const compliance = getRoleById("compliance_research");
    if (!compliance) {
      throw new Error("expected compliance_research role to exist");
    }
    if (!roleAllowsDeliverable(compliance, "legal-memo")) {
      throw new Error("compliance_research should allow legal-memo");
    }
    if (roleAllowsDeliverable(compliance, "litigation-outline")) {
      throw new Error("compliance_research should NOT allow litigation-outline");
    }
    console.log(`  ✓ ${roles.length} roles loaded; deliverable allowlist enforced.`);

    step("2/7 W3 写侧：创建 matter（JSON 真相源）");
    const matterId = "q12-demo-matter";
    const matter = createMatterIfMissing(ws, {
      matterId,
      title: "季末 Demo · 高风险律师函",
      status: "active",
    });
    console.log(`  ✓ matter ${matter.matterId} 落盘，title=${matter.title}`);

    step("3/7 W3 写侧：planned deliverable + 待审 queue + 高风险 approval");
    const deliverable = createPlannedDeliverable(ws, {
      matterId,
      deliverableId: "q12-deliv-1",
      taskId: "q12-task-1",
      kind: "demand-letter",
      audience: "counterparty",
    });
    const queueItem = openQueueItem(ws, {
      matterId,
      kind: "need_lawyer_review",
      title: "草稿待合伙人复核",
      relatedTaskId: deliverable.taskId,
      priority: "high",
    });
    const approval = requestApproval(ws, {
      matterId,
      deliverableId: deliverable.deliverableId,
      requestedBy: "lawyer:senior",
      requestedRole: "general_litigation",
      targetRole: "general_default",
      reason: "高风险律师函，需要 supervising partner 签字",
      riskLevel: "high",
    });
    console.log(
      `  ✓ deliverable=${deliverable.deliverableId} queue=${queueItem.queueItemId} approval=${approval.approvalId}`,
    );

    step("4/7 W4 状态推进：deliverable 完整生命周期 + queue → resolved + approval → approved");
    transitionDeliverable(ws, matterId, deliverable.deliverableId, "drafting");
    transitionDeliverable(ws, matterId, deliverable.deliverableId, "pending_review");
    transitionDeliverable(ws, matterId, deliverable.deliverableId, "approved");
    const transitioned = transitionDeliverable(ws, matterId, deliverable.deliverableId, "rendered");
    if (transitioned?.status !== "rendered") {
      throw new Error("deliverable transition failed");
    }
    const queueResolved = transitionQueueItem(ws, matterId, queueItem.queueItemId, "resolved");
    if (queueResolved?.status !== "resolved") {
      throw new Error("queue transition failed");
    }
    const approvalResolved = resolveApproval(ws, matterId, approval.approvalId, {
      status: "approved",
      resolvedBy: "lawyer:partner",
    });
    if (approvalResolved.outcome !== "written" || approvalResolved.approval.status !== "approved") {
      throw new Error("approval transition failed");
    }
    console.log("  ✓ 三类状态机均完成 happy-path 跃迁。");

    step("5/7 W9 Reasoning Gate：高风险 deliverable 必须有推理图谱（无图时阻断）");
    const reasoningReport = validateReasoningAgainstSpec(undefined, "litigation.outline");
    if (!reasoningReport.required) {
      throw new Error("litigation.outline should require reasoning gate");
    }
    if (reasoningReport.ready) {
      throw new Error("missing reasoning graph should NOT be ready");
    }
    console.log(
      `  ✓ required=${reasoningReport.required} ready=${reasoningReport.ready} ` +
        `blockers=${reasoningReport.blockerCount}`,
    );

    step("6/7 W5 Memory Adoption：律师档案学习入队（不直写 markdown）");
    const suggestion = await suggestMemoryAdoption(ws, auditDir, {
      scope: "matter",
      kind: "case.core_issue",
      payload: "争议焦点：违约金调整 — 适用《合同法》第 114 条 vs.《民法典》第 585 条",
      sourceTaskId: "q12-task-1",
      targetId: matterId,
      origin: "engine",
    });
    const pending = await listMemorySuggestions(ws, { state: "pending", scope: "matter" });
    if (pending.length === 0 || pending[0].id !== suggestion.id) {
      throw new Error("memory suggestion did not enqueue");
    }
    console.log(`  ✓ suggestion=${suggestion.id} 入队，等待 Inspector 律师采纳。`);

    step("7/7 验证 JSON 真相源可被读侧 adapter 直接读取");
    const matterPersisted = loadMatter(ws, matterId);
    const deliverablePersisted = loadDeliverable(ws, matterId, deliverable.deliverableId);
    const approvals = readApprovals(ws, matterId);
    const queue = readQueueItems(ws, matterId);
    if (!matterPersisted || !deliverablePersisted || approvals.length === 0 || queue.length === 0) {
      throw new Error("read-side adapter could not see persisted records");
    }
    console.log(
      `  ✓ matter/${matterId}: status=${matterPersisted.status}, ` +
        `deliverableIds=${matterPersisted.deliverableIds?.length ?? 0}, ` +
        `approvals=${approvals.length}, queueItems=${queue.length}`,
    );

    await seedQualitySnapshot(ws, "q12-task-1", ["质量范例"]);
    await flushQualityDashboard(ws);
    console.log("  ✓ quality snapshot + dashboard.json written for release-readiness");

    const { checkMatterConsistency } =
      await import("../../src/lawmind/application/matter-consistency.js");
    const consistencyIssues = await checkMatterConsistency(ws);
    if (consistencyIssues.length > 0) {
      console.warn(
        `  ⚠ matter consistency: ${consistencyIssues.length} issue(s) (non-blocking WARN)`,
      );
      for (const issue of consistencyIssues.slice(0, 5)) {
        console.warn(`    - ${issue.matterId}: [${issue.code}] ${issue.message}`);
      }
    } else {
      console.log("  ✓ matter JSON ↔ CASE.md consistency OK");
    }

    console.log("\n✅ Quarterly demo passed — 新链路全程跑通，无旧 fallback。");
  } finally {
    if (opts.keepWorkspace) {
      console.log(`\n[Quarterly Demo] 保留 workspace 供检视: ${ws}`);
    } else {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error("[Quarterly Demo] failed:", err);
  process.exitCode = 1;
});
