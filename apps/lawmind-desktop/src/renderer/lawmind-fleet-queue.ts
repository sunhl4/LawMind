/**
 * 在办「队列」分组：待签批 / 待补充 / 待批准（从 LawmindAgentFleetPanel 抽出）。
 */

import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import { isLawyerOutboundDecision } from "../../../../src/lawmind/platform/lawyer-outbound-decision.ts";

/** Keep a valid selection; otherwise open the first ticket so 办理区 is not blank. */
export function resolveFleetSelectedId(
  queue: ReadonlyArray<Pick<AgentRunSummary, "id">>,
  selectedId: string | null,
): string | null {
  if (queue.length === 0) {
    return null;
  }
  if (selectedId && queue.some((row) => row.id === selectedId)) {
    return selectedId;
  }
  return queue[0]?.id ?? null;
}

export function fleetRunNeedsLawyer(run: AgentRunSummary): boolean {
  return isLawyerOutboundDecision({
    kind: run.kind,
    status: run.status,
    toolName: run.toolName,
  });
}

export function fleetStatusKind(
  status: AgentRunSummary["status"],
): "review" | "clarify" | "approve" {
  if (status === "awaiting_clarification") {
    return "clarify";
  }
  if (status === "awaiting_approval") {
    return "approve";
  }
  return "review";
}

/** Dock copy when 在办 hides in-card buttons (`hideActions`). */
export function fleetApprovalDockLabels(actionKind?: string): {
  primary: string;
  secondary: string;
} {
  if (actionKind === "continue_tools") {
    return { primary: "继续", secondary: "先停在这里" };
  }
  return { primary: "批准", secondary: "驳回" };
}

export function fleetStatusLabel(status: AgentRunSummary["status"]): string {
  switch (status) {
    case "awaiting_review":
      return "待签批";
    case "awaiting_clarification":
      return "待补充";
    case "awaiting_approval":
      return "待批准";
    default:
      return "待处理";
  }
}

export const FLEET_GROUP_ORDER = ["review", "clarify", "approve"] as const;

export type FleetGroupKind = (typeof FLEET_GROUP_ORDER)[number];

export function fleetGroupLabel(kind: FleetGroupKind): string {
  switch (kind) {
    case "review":
      return "待签批";
    case "clarify":
      return "待补充";
    case "approve":
      return "待批准";
  }
}

export type FleetQueueGroup = {
  kind: FleetGroupKind;
  label: string;
  items: AgentRunSummary[];
};

const WORK_STATUS_RANK: Record<string, number> = {
  awaiting_review: 3,
  awaiting_approval: 2,
  awaiting_clarification: 1,
};

export function collapseFleetRunsByWork(runs: AgentRunSummary[]): AgentRunSummary[] {
  const groups = new Map<string, AgentRunSummary[]>();
  const rest: AgentRunSummary[] = [];
  for (const run of runs) {
    const workId = run.workId?.trim();
    if (!workId) {
      rest.push(run);
      continue;
    }
    const list = groups.get(workId) ?? [];
    list.push(run);
    groups.set(workId, list);
  }
  const collapsed = [...groups.values()].map((items) => {
    const best = items.reduce((acc, cur) => {
      const accRank = WORK_STATUS_RANK[acc.status] ?? 0;
      const curRank = WORK_STATUS_RANK[cur.status] ?? 0;
      return curRank > accRank ? cur : acc;
    });
    return {
      ...best,
      sessionId: best.sessionId ?? items.find((item) => item.sessionId)?.sessionId,
      taskId: best.taskId ?? items.find((item) => item.taskId)?.taskId,
      queueItemId: best.queueItemId ?? items.find((item) => item.queueItemId)?.queueItemId,
    };
  });
  return [...collapsed, ...rest];
}

export function groupFleetQueue(runs: AgentRunSummary[]): FleetQueueGroup[] {
  const buckets: Record<FleetGroupKind, AgentRunSummary[]> = {
    review: [],
    clarify: [],
    approve: [],
  };
  for (const run of collapseFleetRunsByWork(runs)) {
    buckets[fleetStatusKind(run.status)].push(run);
  }
  return FLEET_GROUP_ORDER.map((kind) => ({
    kind,
    label: fleetGroupLabel(kind),
    items: buckets[kind],
  })).filter((g) => g.items.length > 0);
}

/** After refresh: expand every non-empty queue group. */
export function defaultExpandedFleetGroups(
  groups: Array<Pick<FleetQueueGroup, "kind" | "items">>,
): Set<FleetGroupKind> {
  return new Set(groups.filter((g) => g.items.length > 0).map((g) => g.kind));
}

export const FLEET_COLLAPSED_STORAGE_KEY = "lawmind.fleet.collapsedGroups.v1";

export function readFleetCollapsedGroups(): Set<FleetGroupKind> {
  try {
    const raw = localStorage.getItem(FLEET_COLLAPSED_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(
      parsed.filter((k): k is FleetGroupKind =>
        FLEET_GROUP_ORDER.includes(k as FleetGroupKind),
      ),
    );
  } catch {
    return new Set();
  }
}

export function persistFleetCollapsedGroups(collapsed: Set<FleetGroupKind>): Set<FleetGroupKind> {
  try {
    localStorage.setItem(FLEET_COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed]));
  } catch {
    /* quota/private mode */
  }
  return collapsed;
}
