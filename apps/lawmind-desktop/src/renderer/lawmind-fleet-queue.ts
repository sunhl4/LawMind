/**
 * 在办「队列」分组：待签批 / 待补充 / 待拍板（从 LawmindAgentFleetPanel 抽出）。
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
  kind?: AgentRunSummary["kind"],
): "check" | "review" | "clarify" | "approve" {
  if (kind === "word_check") {
    return "check";
  }
  if (status === "awaiting_clarification") {
    return "clarify";
  }
  if (status === "awaiting_approval" || status === "interrupted") {
    return "approve";
  }
  return "review";
}

/** Dock copy when 在办 hides in-card buttons (`hideActions`). */
/** 待发出行的 inbox id：优先 queueItemId，否则从 `automation-send:` 前缀拆出。 */
export function automationSendInboxId(
  run: { id?: string; queueItemId?: string } | null | undefined,
): string {
  const queued = run?.queueItemId?.trim();
  if (queued) {
    return queued;
  }
  const id = run?.id?.trim() ?? "";
  const prefix = "automation-send:";
  return id.startsWith(prefix) ? id.slice(prefix.length) : "";
}

/** 批量待发信：能发出的 inbox id，以及缺编号的件数。 */
export function collectOutboundInboxIds(
  runs: ReadonlyArray<{ id?: string; queueItemId?: string }>,
): { ids: string[]; missing: number } {
  const ids: string[] = [];
  let missing = 0;
  for (const run of runs) {
    const id = automationSendInboxId(run);
    if (id) {
      ids.push(id);
    } else {
      missing += 1;
    }
  }
  return { ids, missing };
}

export function fleetApprovalDockLabels(
  actionKind?: string,
  trigger?: string,
): {
  primary: string;
  secondary: string;
} {
  if (actionKind === "continue_tools") {
    return trigger === "interrupted"
      ? { primary: "继续本件", secondary: "弃办" }
      : { primary: "继续", secondary: "先停在这里" };
  }
  // 门禁停下的缺口：律师只需确认看到，不必「批准」任何动作。
  if (actionKind === "workflow_blocked") {
    return { primary: "知道了", secondary: "封存本件" };
  }
  return { primary: "签批", secondary: "驳回" };
}

export function fleetStatusLabel(status: AgentRunSummary["status"]): string {
  switch (status) {
    case "awaiting_review":
      return "待签批";
    case "awaiting_clarification":
      return "待补充";
    case "awaiting_approval":
      return "待拍板";
    case "interrupted":
      return "已被中断";
    default:
      return "待处理";
  }
}

export const FLEET_GROUP_ORDER = ["check", "review", "clarify", "approve"] as const;

export type FleetGroupKind = (typeof FLEET_GROUP_ORDER)[number];

const FLEET_GROUP_LABELS: Record<FleetGroupKind, string> = {
  check: "待核对",
  review: "待签批",
  clarify: "待补充",
  approve: "待拍板",
};

export function fleetGroupLabel(kind: FleetGroupKind): string {
  return FLEET_GROUP_LABELS[kind];
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
    check: [],
    review: [],
    clarify: [],
    approve: [],
  };
  for (const run of collapseFleetRunsByWork(runs)) {
    buckets[fleetStatusKind(run.status, run.kind)].push(run);
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
