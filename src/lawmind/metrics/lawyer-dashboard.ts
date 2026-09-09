/**
 * 律师可观测性仪表盘 — 案件级真实口径指标。
 *
 * 不计算无法验证的「安全分/质量分」。每个指标都基于已落地的 runtime-events、
 * lint 结果、签批/任务/期限状态，并在注释中给出计算口径。
 */

import {
  readApprovals,
  readDeadlines,
  readQueueItems,
  listMatterIdsFromStorage,
  type ApprovalRecord,
  type DeadlineRecord,
  type QueueItemRecord,
  loadMatter,
  type MatterRecord,
} from "../adapters/matter-storage/index.js";
import { CITATION_VALIDITY_RULE_COUNT } from "../lint/citation-validity.js";
import { LEGAL_LINT_RULES } from "../lint/rules.js";
import { listProductMetricEvents, type ProductMetricEvent } from "./product-metrics.js";
import { listRuntimeEvents, type RuntimeEvent } from "./runtime-events.js";

export type MatterPhase = "intake" | "draft" | "review" | "delivery" | "closed";

export type MatterHealthMetrics = {
  matterId: string;
  taskId?: string | null;
  /** 机械核对规则覆盖率：已触发规则数 / 已注册相关规则数 */
  lintCoverageRate: number | null;
  /** 律师编辑率：AI 建议后被律师实质修改的比例 */
  editRate: number | null;
  /** 首次交付无需修改的比例 */
  firstPassRate: number | null;
  /** 当前待拍板数量 */
  pendingApprovals: number;
  /** 逾期任务数（有 deadline 且过期） */
  overdueTasks: number;
  /** 最近活动时间（ISO 字符串） */
  lastActivityAt: string | null;
  /** 已触发机械核对规则数 */
  lintTriggerCount: number;
  /** 已注册相关规则数（分母） */
  lintRuleCount: number;
  /** 机械核对发现的问题数（blocker + warning + failCount） */
  lintFindingCount: number;
  /** 律师编辑事件总数 */
  lawyerEditCount: number;
  /** 律师实质修改次数 */
  lawyerEditModifiedCount: number;
  /** 交付事件总数 */
  deliverCount: number;
  /** 首次即过交付数 */
  deliverFirstPassCount: number;
  /** 待律师审核队列项数 */
  pendingReviewCount: number;
  /** 当前阶段 */
  phase: MatterPhase;
};

export type MatterHealthMetricsInput = {
  matterId: string;
  taskId?: string | null;
  runtimeEvents?: RuntimeEvent[];
  productMetrics?: ProductMetricEvent[];
  approvalRecords?: ApprovalRecord[];
  queueRecords?: QueueItemRecord[];
  deadlineRecords?: DeadlineRecord[];
  /** 外部注册规则集；缺省时使用引擎内置机械核对规则库 */
  registeredRuleIds?: string[];
  now?: Date;
};

/** 引擎内置机械核对规则库规模（LEGAL_LINT_RULES + 引用有效性 2 条）。 */
const DEFAULT_REGISTERED_RULE_COUNT = LEGAL_LINT_RULES.length + CITATION_VALIDITY_RULE_COUNT;

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function parseTimestamp(ts: string | undefined | null): number | null {
  if (!ts) {
    return null;
  }
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : null;
}

function latestTimestamp(...values: (string | null | undefined)[]): string | null {
  let max = -Infinity;
  let winner: string | null = null;
  for (const raw of values) {
    if (!raw) {
      continue;
    }
    const n = Date.parse(raw);
    if (Number.isFinite(n) && n > max) {
      max = n;
      winner = raw;
    }
  }
  return winner;
}

/**
 * 口径：事件是否属于目标案件（及目标任务）。
 * runtime-events 与 product-metrics 均可能在 matterId 缺失时仅携带 taskId；
 * 当 taskId 过滤开启时，要求事件 taskId 匹配；按案件过滤时优先匹配 matterId。
 */
function matchesMatterAndTask(
  event: { matterId?: string | null; taskId?: string | null },
  matterId: string,
  taskId?: string | null,
): boolean {
  if (taskId) {
    return event.taskId === taskId;
  }
  if (event.matterId) {
    return event.matterId === matterId;
  }
  return false;
}

function resolvePhase(metrics: MatterHealthMetrics): MatterPhase {
  if (metrics.pendingApprovals > 0) {
    return "review";
  }
  if (metrics.pendingReviewCount > 0) {
    return "draft";
  }
  if (metrics.deliverCount > 0) {
    return "delivery";
  }
  if (metrics.lawyerEditModifiedCount > 0) {
    return "draft";
  }
  return "intake";
}

/**
 * 计算单个案件（或单个任务）的健康指标。
 *
 * 各指标口径：
 * - lintCoverageRate：unique(ruleIds across lint_run events) / registeredRuleCount。
 *   未提供注册规则集时，分母使用引擎内置机械核对规则库数量，表示对「已知机械缺陷集合」的覆盖。
 * - editRate：lawyer_edit 中 outcome === "modified" 的事件数 / 全部 lawyer_edit 事件数。
 *   只计律师实质修改，approved / rejected 不纳入分子。
 * - firstPassRate：deliver 事件中 meta.firstPass === true 的比例。
 * - pendingApprovals：approvalRecords 中 status === "pending" 的数量。
 * - overdueTasks：deadlineRecords 中 status === "open" 且 dueAt < now 的数量。
 * - lastActivityAt：runtime-events、product-metrics、approvalRecords、queueRecords、deadlineRecords 中最新时间戳。
 */
export function buildMatterHealthMetrics(input: MatterHealthMetricsInput): MatterHealthMetrics {
  const {
    matterId,
    taskId,
    runtimeEvents = [],
    productMetrics = [],
    approvalRecords = [],
    queueRecords = [],
    deadlineRecords = [],
    registeredRuleIds,
    now = new Date(),
  } = input;

  const lintRuleCount = registeredRuleIds?.length ?? DEFAULT_REGISTERED_RULE_COUNT;

  const triggeredRuleIds = new Set<string>();
  let lintRunCount = 0;
  let lintFindingCount = 0;
  let lawyerEditCount = 0;
  let lawyerEditModifiedCount = 0;
  let deliverCount = 0;
  let deliverFirstPassCount = 0;
  let lastActivityAt: string | null = null;

  for (const ev of runtimeEvents) {
    if (!matchesMatterAndTask(ev, matterId, taskId)) {
      continue;
    }
    lastActivityAt = latestTimestamp(lastActivityAt, ev.ts);

    if (ev.kind === "lint_run") {
      lintRunCount += 1;
      const ruleIds = Array.isArray(ev.meta?.ruleIds) ? ev.meta.ruleIds : [];
      for (const id of ruleIds) {
        if (typeof id === "string" && id.trim()) {
          triggeredRuleIds.add(id.trim());
        }
      }
      const failCount = typeof ev.meta?.failCount === "number" ? ev.meta.failCount : 0;
      const blockerCount = typeof ev.meta?.blockerCount === "number" ? ev.meta.blockerCount : 0;
      const warningCount = typeof ev.meta?.warningCount === "number" ? ev.meta.warningCount : 0;
      lintFindingCount += failCount + blockerCount + warningCount;
    }

    if (ev.kind === "lawyer_edit") {
      lawyerEditCount += 1;
      const outcome = ev.meta?.outcome;
      if (outcome === "modified") {
        lawyerEditModifiedCount += 1;
      }
    }

    if (ev.kind === "deliver") {
      deliverCount += 1;
      if (ev.meta?.firstPass === true) {
        deliverFirstPassCount += 1;
      }
    }
  }

  for (const ev of productMetrics) {
    if (!matchesMatterAndTask(ev, matterId, taskId)) {
      continue;
    }
    lastActivityAt = latestTimestamp(lastActivityAt, ev.ts);
  }

  for (const a of approvalRecords) {
    if (a.matterId !== matterId) {
      continue;
    }
    lastActivityAt = latestTimestamp(lastActivityAt, a.requestedAt, a.resolvedAt);
  }

  const pendingApprovals = approvalRecords.filter(
    (a) => a.matterId === matterId && a.status === "pending",
  ).length;

  const pendingReviewCount = queueRecords.filter(
    (q) => q.matterId === matterId && q.status === "open" && q.kind === "need_lawyer_review",
  ).length;

  const nowMs = now.getTime();
  let overdueTasks = 0;
  for (const d of deadlineRecords) {
    if (d.matterId !== matterId) {
      continue;
    }
    lastActivityAt = latestTimestamp(lastActivityAt, d.dueAt);
    if (d.status === "open" || d.status === "missed") {
      const due = parseTimestamp(d.dueAt);
      if (due !== null && due < nowMs) {
        overdueTasks += 1;
      }
    }
  }

  for (const q of queueRecords) {
    if (q.matterId === matterId) {
      lastActivityAt = latestTimestamp(lastActivityAt, q.updatedAt, q.createdAt);
    }
  }

  const lintTriggerCount = triggeredRuleIds.size;
  const lintCoverageRate = lintRunCount > 0 ? rate(lintTriggerCount, lintRuleCount) : null;
  const editRate = lawyerEditCount > 0 ? rate(lawyerEditModifiedCount, lawyerEditCount) : null;
  const firstPassRate = deliverCount > 0 ? rate(deliverFirstPassCount, deliverCount) : null;

  const base: MatterHealthMetrics = {
    matterId,
    taskId,
    lintCoverageRate,
    editRate,
    firstPassRate,
    pendingApprovals,
    overdueTasks,
    lastActivityAt,
    lintTriggerCount,
    lintRuleCount,
    lintFindingCount,
    lawyerEditCount,
    lawyerEditModifiedCount,
    deliverCount,
    deliverFirstPassCount,
    pendingReviewCount,
    phase: "intake",
  };

  return { ...base, phase: resolvePhase(base) };
}

/**
 * 从工作区真相源读取指定案件（或指定任务）的指标。
 */
export function readMatterHealthMetrics(
  workspaceDir: string,
  matterId: string,
  opts?: { taskId?: string; now?: Date },
): MatterHealthMetrics {
  const taskId = opts?.taskId?.trim() || null;
  const runtimeEvents = listRuntimeEvents(workspaceDir);
  const productMetrics = listProductMetricEvents(workspaceDir);
  const approvalRecords = readApprovals(workspaceDir, matterId);
  const queueRecords = readQueueItems(workspaceDir, matterId);
  const deadlineRecords = readDeadlines(workspaceDir, matterId);

  return buildMatterHealthMetrics({
    matterId,
    taskId,
    runtimeEvents,
    productMetrics,
    approvalRecords,
    queueRecords,
    deadlineRecords,
    now: opts?.now,
  });
}

export type LawyerDeskDashboardItem = {
  matterId: string;
  displayName: string;
  metrics: MatterHealthMetrics;
};

export type LawyerDeskDashboard = {
  capturedAt: string;
  items: LawyerDeskDashboardItem[];
  totalPendingApprovals: number;
  totalOverdueTasks: number;
  todayActivityCount: number;
  thisWeekFirstPassCount: number;
};

function startOfDayLocal(d: Date): Date {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next;
}

/**
 * 汇总全工作区仪表盘。
 *
 * 聚合口径：
 * - todayActivityCount：今日（本地 0 点起）runtime-events 总数。
 * - thisWeekFirstPassCount：近 7 天内 deliver 且 firstPass 的事件数。
 * - totalPendingApprovals / totalOverdueTasks：各案件 pendingApprovals / overdueTasks 之和。
 * - items 按最近活动时间倒序排列。
 */
export function buildLawyerDeskDashboard(
  workspaceDir: string,
  opts?: { now?: Date },
): LawyerDeskDashboard {
  const now = opts?.now ?? new Date();
  const matterIds = listMatterIdsFromStorage(workspaceDir);
  const items: LawyerDeskDashboardItem[] = [];
  let totalPendingApprovals = 0;
  let totalOverdueTasks = 0;

  for (const matterId of matterIds) {
    const matter: MatterRecord | undefined = loadMatter(workspaceDir, matterId);
    const metrics = readMatterHealthMetrics(workspaceDir, matterId, { now });
    totalPendingApprovals += metrics.pendingApprovals;
    totalOverdueTasks += metrics.overdueTasks;
    items.push({
      matterId,
      displayName: matter?.title?.trim() || matterId,
      metrics,
    });
  }

  items.sort((a, b) => {
    const ta = a.metrics.lastActivityAt ? Date.parse(a.metrics.lastActivityAt) : -Infinity;
    const tb = b.metrics.lastActivityAt ? Date.parse(b.metrics.lastActivityAt) : -Infinity;
    return tb - ta;
  });

  const runtimeEvents = listRuntimeEvents(workspaceDir);
  const todayStart = startOfDayLocal(now).getTime();
  let todayActivityCount = 0;
  let thisWeekFirstPassCount = 0;
  const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  for (const ev of runtimeEvents) {
    const t = parseTimestamp(ev.ts);
    if (t === null) {
      continue;
    }
    if (t >= todayStart) {
      todayActivityCount += 1;
    }
    if (t >= weekStart && ev.kind === "deliver" && ev.meta?.firstPass === true) {
      thisWeekFirstPassCount += 1;
    }
  }

  return {
    capturedAt: now.toISOString(),
    items,
    totalPendingApprovals,
    totalOverdueTasks,
    todayActivityCount,
    thisWeekFirstPassCount,
  };
}

/**
 * 格式化指标为律师可读字符串（如「12% 已核对」「3 项待拍板」）。
 */
export function formatMatterHealthRate(rateValue: number | null): string {
  if (rateValue === null) {
    return "—";
  }
  return `${Math.round(rateValue * 100)}%`;
}

export function formatMatterHealthCount(count: number, unit: string): string {
  return count > 0 ? `${count} ${unit}` : `无${unit}`;
}
