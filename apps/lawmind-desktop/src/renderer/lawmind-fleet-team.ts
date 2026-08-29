/**
 * 在办「团队」聚合：按助手分行，供领导视图使用。
 */

import type {
  AgentRunSummary,
  AssistantGrowthReportView,
} from "./lawmind-agent-fleet-api";

export const FLEET_UNASSIGNED_ID = "__unassigned__";

export type FleetTeamBusy = "idle" | "awaiting_lawyer" | "working";

export type FleetTeamRow = {
  assistantId: string;
  displayName: string;
  roleId?: string;
  awaitingCount: number;
  workingCount: number;
  busy: FleetTeamBusy;
  currentTitle?: string;
  windowFirstPassRate?: number;
  windowTasksReviewed?: number;
  lifetimeFirstPassRate?: number;
  lifetimeTasksReviewed?: number;
  pendingAdoptions: number;
  /** 均改写字数（绝对差）；无样本时不设 */
  avgRewriteAbsChars?: number;
};

/** e.g. `62% → 78%` when both lifetime and window have samples */
export function formatGrowthTrend(row: {
  lifetimeFirstPassRate?: number;
  lifetimeTasksReviewed?: number;
  windowFirstPassRate?: number;
  windowTasksReviewed?: number;
}): string | null {
  const lifeOk = (row.lifetimeTasksReviewed ?? 0) > 0 && row.lifetimeFirstPassRate != null;
  const winOk = (row.windowTasksReviewed ?? 0) > 0 && row.windowFirstPassRate != null;
  if (lifeOk && winOk) {
    return `${Math.round(row.lifetimeFirstPassRate! * 100)}% → ${Math.round(row.windowFirstPassRate! * 100)}%`;
  }
  if (winOk) {
    return `近窗 ${Math.round(row.windowFirstPassRate! * 100)}%`;
  }
  if (lifeOk) {
    return `累计 ${Math.round(row.lifetimeFirstPassRate! * 100)}%`;
  }
  return null;
}

function isAwaitingLawyer(status: AgentRunSummary["status"]): boolean {
  return (
    status === "awaiting_clarification" ||
    status === "awaiting_approval" ||
    status === "awaiting_review"
  );
}

function isWorking(status: AgentRunSummary["status"]): boolean {
  return (
    status === "running" ||
    status === "queued" ||
    status === "scheduled"
  );
}

function busyRank(b: FleetTeamBusy): number {
  if (b === "awaiting_lawyer") {
    return 0;
  }
  if (b === "working") {
    return 1;
  }
  return 2;
}

export function fleetTeamBusyLabel(busy: FleetTeamBusy): string {
  switch (busy) {
    case "awaiting_lawyer":
      return "待你拍板";
    case "working":
      return "执行中";
    default:
      return "空闲";
  }
}

/**
 * Build team rows from queue runs + growth report.
 * Includes assistants with growth history even when currently idle.
 */
export function buildFleetTeamRows(opts: {
  runs: AgentRunSummary[];
  growth?: AssistantGrowthReportView | null;
  displayById?: Record<string, string>;
}): FleetTeamRow[] {
  const displayById = opts.displayById ?? {};
  const byId = new Map<string, FleetTeamRow>();

  const ensure = (assistantId: string, roleId?: string): FleetTeamRow => {
    const id = assistantId.trim() || FLEET_UNASSIGNED_ID;
    const prev = byId.get(id);
    if (prev) {
      if (roleId && !prev.roleId) {
        prev.roleId = roleId;
      }
      return prev;
    }
    const row: FleetTeamRow = {
      assistantId: id,
      displayName:
        id === FLEET_UNASSIGNED_ID
          ? "未指派"
          : displayById[id]?.trim() || id,
      roleId,
      awaitingCount: 0,
      workingCount: 0,
      busy: "idle",
      pendingAdoptions: 0,
    };
    byId.set(id, row);
    return row;
  };

  for (const g of opts.growth?.assistants ?? []) {
    const row = ensure(g.assistantId, g.roleId);
    row.windowFirstPassRate = g.window.firstPassRate;
    row.windowTasksReviewed = g.window.tasksReviewed;
    row.lifetimeFirstPassRate = g.lifetime.firstPassRate;
    row.lifetimeTasksReviewed = g.lifetime.tasksReviewed;
    row.pendingAdoptions = g.pendingAdoptions;
    if (g.rewriteAmplitude && g.rewriteAmplitude.samples > 0) {
      row.avgRewriteAbsChars = g.rewriteAmplitude.avgAbsCharDelta;
    }
    if (g.lifetime.tasksReviewed > 0 || g.window.tasksReviewed > 0 || g.pendingAdoptions > 0) {
      // keep row even if idle
    }
  }

  for (const run of opts.runs) {
    const id = run.assistantId?.trim() || FLEET_UNASSIGNED_ID;
    const row = ensure(id);
    if (isAwaitingLawyer(run.status)) {
      row.awaitingCount += 1;
      if (!row.currentTitle) {
        row.currentTitle = run.title;
      }
    } else if (isWorking(run.status)) {
      row.workingCount += 1;
      if (!row.currentTitle) {
        row.currentTitle = run.title;
      }
    }
  }

  for (const row of byId.values()) {
    if (row.awaitingCount > 0) {
      row.busy = "awaiting_lawyer";
    } else if (row.workingCount > 0) {
      row.busy = "working";
    } else {
      row.busy = "idle";
    }
  }

  return [...byId.values()].toSorted((a, b) => {
    const br = busyRank(a.busy) - busyRank(b.busy);
    if (br !== 0) {
      return br;
    }
    const aq = b.awaitingCount - a.awaitingCount;
    if (aq !== 0) {
      return aq;
    }
    return a.displayName.localeCompare(b.displayName, "zh");
  });
}

export function filterRunsByAssistant(
  runs: AgentRunSummary[],
  assistantFilter: string | null,
): AgentRunSummary[] {
  if (!assistantFilter) {
    return runs;
  }
  if (assistantFilter === FLEET_UNASSIGNED_ID) {
    return runs.filter((r) => !r.assistantId?.trim());
  }
  return runs.filter((r) => (r.assistantId?.trim() || "") === assistantFilter);
}
