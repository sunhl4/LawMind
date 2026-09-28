import type { AgentRunSummary } from "./lawmind-agent-fleet-api";

/** 左栏实际画出来的行序。收起的分组不参与 Shift 连选。 */
export function fleetListOrderedIds(
  docket: {
    needsYou: ReadonlyArray<{ id: string }>;
    inFlight: ReadonlyArray<{ id: string }>;
    settled: ReadonlyArray<{ id: string }>;
  },
  open: { inFlight: boolean; settled: boolean },
): string[] {
  const ids = docket.needsYou.map((run) => run.id);
  if (open.inFlight) {
    ids.push(...docket.inFlight.map((run) => run.id));
  }
  if (open.settled) {
    ids.push(...docket.settled.map((run) => run.id));
  }
  return ids;
}

export function fleetRunIsOutboundSend(run: { id: string; kind?: string }): boolean {
  return run.kind === "automation_send" || run.id.startsWith("automation-send:");
}

/** 两件及以上、且全部是待发信时，才能一起批准或驳回。 */
export function fleetBatchOutboundSends(
  runs: ReadonlyArray<AgentRunSummary>,
): AgentRunSummary[] | null {
  if (runs.length < 2 || !runs.every(fleetRunIsOutboundSend)) {
    return null;
  }
  return [...runs];
}
