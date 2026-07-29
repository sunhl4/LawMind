/**
 * 在办「队列」分组：待签批 / 待补充 / 待批准（从 LawmindAgentFleetPanel 抽出）。
 */

import type { AgentRunSummary } from "./lawmind-agent-fleet-api";

export function fleetRunNeedsLawyer(run: AgentRunSummary): boolean {
  return (
    run.status === "awaiting_clarification" ||
    run.status === "awaiting_approval" ||
    run.status === "awaiting_review"
  );
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

export function groupFleetQueue(runs: AgentRunSummary[]): FleetQueueGroup[] {
  const buckets: Record<FleetGroupKind, AgentRunSummary[]> = {
    review: [],
    clarify: [],
    approve: [],
  };
  for (const run of runs) {
    buckets[fleetStatusKind(run.status)].push(run);
  }
  return FLEET_GROUP_ORDER.map((kind) => ({
    kind,
    label: fleetGroupLabel(kind),
    items: buckets[kind],
  })).filter((g) => g.items.length > 0);
}
