/**
 * Delegation registry — tracks inter-assistant task delegations.
 *
 * Adapted from OpenClaw's subagent-registry.ts:
 *   - In-memory Map<delegationId, DelegationRecord> with disk persistence
 *   - Lifecycle tracking (created → running → completed/failed/timeout)
 *   - Depth limits to prevent runaway recursive delegation
 *   - Frozen result capture for completed delegations
 *
 * Persistence: workspace/delegations/<delegationId>.json
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  CollaborationEvent,
  CollaborationPolicy,
  DelegationRecord,
  DelegationStatus,
} from "./types.js";

const DELEGATIONS_DIR = "delegations";
const MAX_FROZEN_RESULT_BYTES = 102_400;

const registry = new Map<string, DelegationRecord>();

function delegationsDir(workspaceDir: string): string {
  return path.join(workspaceDir, DELEGATIONS_DIR);
}

function delegationFilePath(workspaceDir: string, delegationId: string): string {
  return path.join(delegationsDir(workspaceDir), `${delegationId}.json`);
}

function persistRecord(workspaceDir: string, record: DelegationRecord): void {
  const dir = delegationsDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    delegationFilePath(workspaceDir, record.delegationId),
    JSON.stringify(record, null, 2),
    "utf8",
  );
}

// ─────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────

export function registerDelegation(params: {
  workspaceDir: string;
  fromAssistantId: string;
  toAssistantId: string;
  task: string;
  matterId?: string;
  priority?: "normal" | "high" | "low";
  depth?: number;
  targetSessionId?: string;
}): DelegationRecord {
  const record: DelegationRecord = {
    delegationId: randomUUID(),
    fromAssistantId: params.fromAssistantId,
    toAssistantId: params.toAssistantId,
    task: params.task,
    matterId: params.matterId,
    priority: params.priority ?? "normal",
    status: "pending",
    targetSessionId: params.targetSessionId,
    depth: params.depth ?? 0,
    startedAt: new Date().toISOString(),
  };

  registry.set(record.delegationId, record);
  persistRecord(params.workspaceDir, record);
  return record;
}

// ─────────────────────────────────────────────
// Lifecycle updates
// ─────────────────────────────────────────────

export function markDelegationRunning(
  workspaceDir: string,
  delegationId: string,
  targetSessionId: string,
): DelegationRecord | undefined {
  const record = registry.get(delegationId);
  if (!record) {
    return undefined;
  }
  record.status = "running";
  record.targetSessionId = targetSessionId;
  persistRecord(workspaceDir, record);
  return record;
}

export function markDelegationCompleted(
  workspaceDir: string,
  delegationId: string,
  result: string,
): DelegationRecord | undefined {
  const record = registry.get(delegationId);
  if (!record) {
    return undefined;
  }
  record.status = "completed";
  record.result = result.slice(0, MAX_FROZEN_RESULT_BYTES);
  record.completedAt = new Date().toISOString();
  persistRecord(workspaceDir, record);
  return record;
}

export function markDelegationFailed(
  workspaceDir: string,
  delegationId: string,
  error: string,
): DelegationRecord | undefined {
  const record = registry.get(delegationId);
  if (!record) {
    return undefined;
  }
  record.status = "failed";
  record.error = error;
  record.completedAt = new Date().toISOString();
  persistRecord(workspaceDir, record);
  return record;
}

export function markDelegationTimeout(
  workspaceDir: string,
  delegationId: string,
): DelegationRecord | undefined {
  const record = registry.get(delegationId);
  if (!record) {
    return undefined;
  }
  record.status = "timeout";
  record.error = "Delegation timed out";
  record.completedAt = new Date().toISOString();
  persistRecord(workspaceDir, record);
  return record;
}

export function cancelDelegation(
  workspaceDir: string,
  delegationId: string,
): DelegationRecord | undefined {
  const record = registry.get(delegationId);
  if (!record) {
    return undefined;
  }
  if (record.status === "completed" || record.status === "failed") {
    return record;
  }
  record.status = "cancelled";
  record.completedAt = new Date().toISOString();
  persistRecord(workspaceDir, record);
  return record;
}

// ─────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────

export function getDelegation(delegationId: string): DelegationRecord | undefined {
  return registry.get(delegationId);
}

export function listDelegations(opts?: {
  fromAssistantId?: string;
  toAssistantId?: string;
  status?: DelegationStatus;
  matterId?: string;
}): DelegationRecord[] {
  let records = [...registry.values()];
  if (opts?.fromAssistantId) {
    records = records.filter((r) => r.fromAssistantId === opts.fromAssistantId);
  }
  if (opts?.toAssistantId) {
    records = records.filter((r) => r.toAssistantId === opts.toAssistantId);
  }
  if (opts?.status) {
    records = records.filter((r) => r.status === opts.status);
  }
  if (opts?.matterId) {
    records = records.filter((r) => r.matterId === opts.matterId);
  }
  return records.toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function countActiveDelegations(assistantId: string): number {
  let count = 0;
  for (const record of registry.values()) {
    if (
      record.fromAssistantId === assistantId &&
      (record.status === "pending" || record.status === "running")
    ) {
      count++;
    }
  }
  return count;
}

// ─────────────────────────────────────────────
// Policy enforcement
// ─────────────────────────────────────────────

export function validateDelegation(params: {
  fromAssistantId: string;
  toAssistantId: string;
  depth: number;
  policy: CollaborationPolicy;
}): string | undefined {
  const { fromAssistantId, toAssistantId, depth, policy } = params;

  if (fromAssistantId === toAssistantId) {
    return "Cannot delegate to self.";
  }

  if (depth >= policy.maxDelegationDepth) {
    return `Delegation depth ${depth} exceeds maximum ${policy.maxDelegationDepth}.`;
  }

  const active = countActiveDelegations(fromAssistantId);
  if (active >= policy.maxActiveDelegationsPerAssistant) {
    return `Assistant ${fromAssistantId} has ${active} active delegations (max ${policy.maxActiveDelegationsPerAssistant}).`;
  }

  if (policy.allowedPairs.length > 0) {
    const pairKey = `${fromAssistantId}:${toAssistantId}`;
    if (!policy.allowedPairs.includes(pairKey)) {
      return `Communication from ${fromAssistantId} to ${toAssistantId} is not allowed by policy.`;
    }
  }

  return undefined;
}

// ─────────────────────────────────────────────
// Disk restore (on startup)
// ─────────────────────────────────────────────

export function restoreDelegationsFromDisk(workspaceDir: string): number {
  const dir = delegationsDir(workspaceDir);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    let count = 0;
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), "utf8");
        const record = JSON.parse(raw) as DelegationRecord;
        if (record.delegationId && !registry.has(record.delegationId)) {
          registry.set(record.delegationId, record);
          count++;
        }
      } catch {
        /* skip corrupt files */
      }
    }
    return count;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────
// Collaboration event builder
// ─────────────────────────────────────────────

export function buildDelegationEvent(
  record: DelegationRecord,
  kind: CollaborationEvent["kind"],
  detail?: string,
): CollaborationEvent {
  return {
    eventId: randomUUID(),
    kind,
    delegationId: record.delegationId,
    fromAssistantId: record.fromAssistantId,
    toAssistantId: record.toAssistantId,
    matterId: record.matterId,
    detail: detail ?? record.task.slice(0, 120),
    timestamp: new Date().toISOString(),
  };
}
