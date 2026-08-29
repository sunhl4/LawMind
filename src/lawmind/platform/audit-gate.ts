/**
 * Platform gate snapshots — structured audit trail for executionState / gateDecisions.
 */

import path from "node:path";
import { emit, readAllAuditLogs } from "../audit/index.js";
import type { AuditEvent } from "../types.js";
import type { GateDecision, TaskExecutionState } from "./contracts.js";
import { withGateCategories } from "./gate-category.js";

export const PLATFORM_GATE_AUDIT_KIND = "platform.gate_snapshot" as const;

export type PlatformGateAuditSource =
  | "review"
  | "reopen_review"
  | "render"
  | "render_blocked"
  | "workflow_job"
  | "agent_turn";

export type PlatformGateSnapshotDetail = {
  v: 1;
  source: PlatformGateAuditSource;
  executionState?: TaskExecutionState;
  gateDecisions?: GateDecision[];
  context?: Record<string, string>;
};

export type PlatformGateHistoryItem = {
  eventId: string;
  taskId: string;
  timestamp: string;
  actor: AuditEvent["actor"];
  actorId?: string;
  source: PlatformGateAuditSource;
  executionState?: TaskExecutionState;
  gateDecisions: GateDecision[];
  context?: Record<string, string>;
};

export function serializePlatformGateSnapshotDetail(
  params: Omit<PlatformGateSnapshotDetail, "v">,
): string {
  const body: PlatformGateSnapshotDetail = { v: 1, ...params };
  return JSON.stringify(body);
}

export function parsePlatformGateSnapshotDetail(
  detail: string | undefined,
): PlatformGateSnapshotDetail | null {
  if (!detail?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(detail) as PlatformGateSnapshotDetail;
    if (parsed?.v !== 1 || typeof parsed.source !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export type EmitPlatformGateSnapshotParams = {
  taskId: string;
  source: PlatformGateAuditSource;
  actor: AuditEvent["actor"];
  actorId?: string;
  executionState?: TaskExecutionState;
  gateDecisions?: GateDecision[];
  context?: Record<string, string>;
};

/**
 * Persist one platform gate snapshot (non-blocking callers may void the promise).
 */
export async function emitPlatformGateSnapshot(
  auditDir: string,
  params: EmitPlatformGateSnapshotParams,
): Promise<AuditEvent> {
  const gateDecisions = withGateCategories(params.gateDecisions);
  return emit(auditDir, {
    taskId: params.taskId,
    kind: PLATFORM_GATE_AUDIT_KIND,
    actor: params.actor,
    actorId: params.actorId,
    detail: serializePlatformGateSnapshotDetail({
      source: params.source,
      executionState: params.executionState,
      gateDecisions: gateDecisions.length > 0 ? gateDecisions : params.gateDecisions,
      context: params.context,
    }),
  });
}

function auditEventToHistoryItem(event: AuditEvent): PlatformGateHistoryItem | null {
  const parsed = parsePlatformGateSnapshotDetail(event.detail);
  if (!parsed) {
    return null;
  }
  return {
    eventId: event.eventId,
    taskId: event.taskId,
    timestamp: event.timestamp,
    actor: event.actor,
    actorId: event.actorId,
    source: parsed.source,
    executionState: parsed.executionState,
    gateDecisions: parsed.gateDecisions ?? [],
    context: parsed.context,
  };
}

/**
 * Recent gate snapshots from workspace audit JSONL (newest first).
 */
export async function listPlatformGateHistory(
  workspaceDir: string,
  limit = 60,
): Promise<PlatformGateHistoryItem[]> {
  const all = await readAllAuditLogs(path.join(workspaceDir, "audit"));
  const n = Math.min(Math.max(limit, 1), 200);
  const out: PlatformGateHistoryItem[] = [];
  for (let i = all.length - 1; i >= 0 && out.length < n; i--) {
    const event = all[i];
    if (!event || event.kind !== PLATFORM_GATE_AUDIT_KIND) {
      continue;
    }
    const row = auditEventToHistoryItem(event);
    if (row) {
      out.push(row);
    }
  }
  return out;
}
