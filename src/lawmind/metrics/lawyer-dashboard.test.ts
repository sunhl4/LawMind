import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendApproval, appendDeadline } from "../adapters/matter-storage/index.js";
import { CITATION_VALIDITY_RULE_COUNT } from "../lint/citation-validity.js";
import { LEGAL_LINT_RULES } from "../lint/rules.js";
import {
  buildLawyerDeskDashboard,
  buildMatterHealthMetrics,
  formatMatterHealthCount,
  formatMatterHealthRate,
  readMatterHealthMetrics,
  type MatterHealthMetricsInput,
} from "./lawyer-dashboard.js";
import { recordDeliverEvent, recordLintRunEvent, type RuntimeEvent } from "./runtime-events.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-lawyer-dashboard-"));
  dirs.push(d);
  return d;
}

function makeInput(overrides?: Partial<MatterHealthMetricsInput>): MatterHealthMetricsInput {
  return {
    matterId: "m-1",
    runtimeEvents: [],
    productMetrics: [],
    approvalRecords: [],
    queueRecords: [],
    deadlineRecords: [],
    now: new Date("2026-09-03T12:00:00.000Z"),
    ...overrides,
  };
}

const now = new Date("2026-09-03T12:00:00.000Z");

describe("buildMatterHealthMetrics", () => {
  it("计算机械核对规则覆盖率、律师编辑率、一次通过率", () => {
    const input = makeInput({
      runtimeEvents: [
        {
          eventId: "e-1",
          ts: "2026-09-01T10:00:00.000Z",
          kind: "lint_run",
          matterId: "m-1",
          taskId: "t-1",
          meta: {
            ruleIds: ["statutory.deposit_cap", "form.or_arbitrate_or_sue"],
            failCount: 1,
            blockerCount: 1,
            warningCount: 0,
          },
        },
        {
          eventId: "e-2",
          ts: "2026-09-01T11:00:00.000Z",
          kind: "lawyer_edit",
          matterId: "m-1",
          taskId: "t-1",
          meta: { outcome: "modified", lintEscape: true },
        },
        {
          eventId: "e-3",
          ts: "2026-09-01T12:00:00.000Z",
          kind: "lawyer_edit",
          matterId: "m-1",
          taskId: "t-1",
          meta: { outcome: "approved", lintEscape: false },
        },
        {
          eventId: "e-4",
          ts: "2026-09-02T09:00:00.000Z",
          kind: "deliver",
          matterId: "m-1",
          taskId: "t-1",
          meta: { firstPass: true, lintEscape: false },
        },
        {
          eventId: "e-5",
          ts: "2026-09-02T10:00:00.000Z",
          kind: "deliver",
          matterId: "m-1",
          taskId: "t-1",
          meta: { firstPass: false, lintEscape: true },
        },
      ] as RuntimeEvent[],
    });

    const metrics = buildMatterHealthMetrics(input);
    const expectedRuleCount = LEGAL_LINT_RULES.length + CITATION_VALIDITY_RULE_COUNT;

    expect(metrics.lintTriggerCount).toBe(2);
    expect(metrics.lintRuleCount).toBe(expectedRuleCount);
    expect(metrics.lintCoverageRate).toBeCloseTo(2 / expectedRuleCount, 10);
    expect(metrics.lintFindingCount).toBe(2); // failCount 1 + blockerCount 1
    expect(metrics.lawyerEditCount).toBe(2);
    expect(metrics.lawyerEditModifiedCount).toBe(1);
    expect(metrics.editRate).toBe(0.5);
    expect(metrics.deliverCount).toBe(2);
    expect(metrics.deliverFirstPassCount).toBe(1);
    expect(metrics.firstPassRate).toBe(0.5);
    expect(metrics.lastActivityAt).toBe("2026-09-02T10:00:00.000Z");
    expect(metrics.phase).toBe("delivery");
  });

  it("按 taskId 过滤只统计该任务的事件", () => {
    const input = makeInput({
      taskId: "t-2",
      runtimeEvents: [
        {
          eventId: "e-1",
          ts: "2026-09-01T10:00:00.000Z",
          kind: "lint_run",
          matterId: "m-1",
          taskId: "t-1",
          meta: {
            ruleIds: ["statutory.deposit_cap"],
            failCount: 1,
            blockerCount: 0,
            warningCount: 0,
          },
        },
        {
          eventId: "e-2",
          ts: "2026-09-01T11:00:00.000Z",
          kind: "deliver",
          matterId: "m-1",
          taskId: "t-2",
          meta: { firstPass: true, lintEscape: false },
        },
      ] as RuntimeEvent[],
    });

    const metrics = buildMatterHealthMetrics(input);
    expect(metrics.deliverCount).toBe(1);
    expect(metrics.deliverFirstPassCount).toBe(1);
    expect(metrics.firstPassRate).toBe(1);
    expect(metrics.lintTriggerCount).toBe(0);
  });

  it("待审批、逾期 deadline 与队列项影响计数与阶段", () => {
    const input = makeInput({
      approvalRecords: [
        {
          approvalId: "a-1",
          matterId: "m-1",
          requestedBy: "system",
          requestedAt: "2026-09-01T10:00:00.000Z",
          reason: "合同审批",
          riskLevel: "high",
          status: "pending",
        },
      ],
      queueRecords: [
        {
          queueItemId: "q-1",
          matterId: "m-1",
          kind: "need_lawyer_review",
          status: "open",
          priority: "high",
          title: "核对交付物",
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:00:00.000Z",
        },
      ],
      deadlineRecords: [
        {
          deadlineId: "d-1",
          matterId: "m-1",
          title: "提交答辩状",
          dueAt: "2026-09-02T10:00:00.000Z",
          severity: "hard",
          source: "manual",
          status: "open",
        },
      ],
    });

    const metrics = buildMatterHealthMetrics(input);
    expect(metrics.pendingApprovals).toBe(1);
    expect(metrics.pendingReviewCount).toBe(1);
    expect(metrics.overdueTasks).toBe(1);
    expect(metrics.phase).toBe("review");
  });

  it("无样本时比率为 null，不编造 0% 或 100%", () => {
    const metrics = buildMatterHealthMetrics(makeInput());
    expect(metrics.lintCoverageRate).toBeNull();
    expect(metrics.editRate).toBeNull();
    expect(metrics.firstPassRate).toBeNull();
    expect(metrics.lastActivityAt).toBeNull();
    expect(metrics.phase).toBe("intake");
  });

  it("可接受外部注册规则集覆盖默认分母", () => {
    const input = makeInput({
      registeredRuleIds: ["rule.a", "rule.b", "rule.c"],
      runtimeEvents: [
        {
          eventId: "e-1",
          ts: "2026-09-01T10:00:00.000Z",
          kind: "lint_run",
          matterId: "m-1",
          meta: { ruleIds: ["rule.a"], failCount: 1, blockerCount: 0, warningCount: 0 },
        },
      ] as RuntimeEvent[],
    });

    const metrics = buildMatterHealthMetrics(input);
    expect(metrics.lintRuleCount).toBe(3);
    expect(metrics.lintCoverageRate).toBeCloseTo(1 / 3, 10);
  });
});

describe("readMatterHealthMetrics", () => {
  it("从工作区真相源读取并计算指标", () => {
    const ws = tmpDir();
    recordLintRunEvent(ws, {
      matterId: "m-1",
      taskId: "t-1",
      ruleIds: ["statutory.deposit_cap"],
      failCount: 1,
      blockerCount: 0,
      warningCount: 0,
    });
    recordDeliverEvent(ws, {
      matterId: "m-1",
      taskId: "t-1",
      deliverableType: "contract.review",
      firstPass: true,
      lintEscape: false,
    });
    appendApproval(ws, {
      approvalId: "a-1",
      matterId: "m-1",
      requestedBy: "system",
      requestedAt: "2026-09-01T10:00:00.000Z",
      reason: "审批",
      riskLevel: "medium",
      status: "pending",
    });
    appendDeadline(ws, {
      deadlineId: "d-1",
      matterId: "m-1",
      title: "开庭",
      dueAt: "2026-09-01T08:00:00.000Z",
      severity: "critical",
      source: "manual",
      status: "open",
    });

    const metrics = readMatterHealthMetrics(ws, "m-1", { now });
    expect(metrics.lintTriggerCount).toBe(1);
    expect(metrics.firstPassRate).toBe(1);
    expect(metrics.pendingApprovals).toBe(1);
    expect(metrics.overdueTasks).toBe(1);
    expect(metrics.phase).toBe("review");
  });
});

describe("buildLawyerDeskDashboard", () => {
  it("汇总全工作区案件并排序", () => {
    const ws = tmpDir();
    // 创建案件目录
    appendApproval(ws, {
      approvalId: "a-m1",
      matterId: "m-1",
      requestedBy: "system",
      requestedAt: "2026-09-01T10:00:00.000Z",
      reason: "占位",
      riskLevel: "low",
      status: "approved",
    });
    appendApproval(ws, {
      approvalId: "a-m2",
      matterId: "m-2",
      requestedBy: "system",
      requestedAt: "2026-09-01T10:00:00.000Z",
      reason: "占位",
      riskLevel: "low",
      status: "approved",
    });

    // m-1 今天有交付，m-2 只有历史事件。
    recordDeliverEvent(ws, {
      matterId: "m-1",
      taskId: "t-1",
      deliverableType: "contract.review",
      firstPass: true,
      lintEscape: false,
    });
    recordDeliverEvent(ws, {
      matterId: "m-2",
      taskId: "t-2",
      deliverableType: "contract.review",
      firstPass: false,
      lintEscape: true,
    });

    const dashboard = buildLawyerDeskDashboard(ws, { now });
    expect(dashboard.items.map((i) => i.matterId)).toContain("m-1");
    expect(dashboard.items.map((i) => i.matterId)).toContain("m-2");
    expect(dashboard.items.length).toBe(2);
    // 按最近活动时间倒序
    const t0 = dashboard.items[0]?.metrics.lastActivityAt;
    const t1 = dashboard.items[1]?.metrics.lastActivityAt;
    if (t0 && t1) {
      expect(Date.parse(t0)).toBeGreaterThanOrEqual(Date.parse(t1));
    }
    expect(dashboard.totalPendingApprovals).toBe(0);
    expect(dashboard.totalOverdueTasks).toBe(0);
    expect(dashboard.todayActivityCount).toBeGreaterThanOrEqual(2);
    expect(dashboard.thisWeekFirstPassCount).toBe(1);
  });
});

describe("format helpers", () => {
  it("格式化比率与计数", () => {
    expect(formatMatterHealthRate(0.125)).toBe("13%");
    expect(formatMatterHealthRate(null)).toBe("—");
    expect(formatMatterHealthCount(3, "项待拍板")).toBe("3 项待拍板");
    expect(formatMatterHealthCount(0, "项待拍板")).toBe("无项待拍板");
  });
});
