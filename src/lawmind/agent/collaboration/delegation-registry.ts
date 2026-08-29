/**
 * Delegation registry — tracks inter-assistant task delegations.
 *
 * Adapted from reference stack's subagent-registry.ts:
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
import { writeJsonAtomic } from "../../adapters/matter-storage/io.js";
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
  writeJsonAtomic(delegationFilePath(workspaceDir, record.delegationId), record);
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
  /** 律师主对话 session，委派结束后回写一条助手消息并供桌面轮询展示 */
  parentSessionId?: string;
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
    parentSessionId: params.parentSessionId?.trim() || undefined,
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

const TERMINAL_DELEGATION_STATUSES = new Set<DelegationStatus>([
  "completed",
  "failed",
  "timeout",
  "cancelled",
  "completed_after_timeout",
]);

function isTerminalDelegationStatus(status: DelegationStatus): boolean {
  return TERMINAL_DELEGATION_STATUSES.has(status);
}

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

function delegationResultMarkdownPath(workspaceDir: string, delegationId: string): string {
  return path.join(delegationsDir(workspaceDir), `${delegationId}.result.md`);
}

export function readDelegationResultFile(
  workspaceDir: string,
  record: DelegationRecord,
): string | undefined {
  const rel = record.resultPath?.trim();
  if (!rel) {
    return undefined;
  }
  const abs = path.isAbsolute(rel) ? rel : path.join(workspaceDir, rel);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return undefined;
  }
}

export function markDelegationCompleted(
  workspaceDir: string,
  delegationId: string,
  result: string,
  targetSessionId?: string,
): DelegationRecord | undefined {
  const record = registry.get(delegationId);
  if (!record) {
    return undefined;
  }
  // 终态守卫：completed/failed/cancelled 后到达的迟到完成直接忽略；
  // timeout 后到达的迟到完成保留结果，但状态标 completed_after_timeout（不再翻转回 completed）。
  if (isTerminalDelegationStatus(record.status)) {
    if (record.status !== "timeout") {
      return record;
    }
    record.status = "completed_after_timeout";
  } else {
    record.status = "completed";
  }
  if (result.length > MAX_FROZEN_RESULT_BYTES) {
    const abs = delegationResultMarkdownPath(workspaceDir, delegationId);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, result, "utf8");
    const rel = path.join(DELEGATIONS_DIR, `${delegationId}.result.md`);
    record.resultPath = rel;
    record.resultTruncated = true;
    const head = result.slice(0, Math.min(8_000, MAX_FROZEN_RESULT_BYTES));
    record.result = `${head}\n\n…[全文已落盘 ${rel}；请用 get_delegation_result 读取完整结果]`;
  } else {
    record.result = result;
    record.resultTruncated = false;
    record.resultPath = undefined;
  }
  const sid = targetSessionId?.trim();
  if (sid) {
    record.targetSessionId = sid;
  }
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
  // 终态守卫：completed/timeout/cancelled 等终态不被迟到的失败回写覆盖。
  if (isTerminalDelegationStatus(record.status)) {
    return record;
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
  // 终态守卫：completed / failed / cancelled 不被迟到的超时回写覆盖。
  if (isTerminalDelegationStatus(record.status)) {
    return record;
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
  if (isTerminalDelegationStatus(record.status)) {
    return record;
  }
  record.status = "cancelled";
  record.completedAt = new Date().toISOString();
  persistRecord(workspaceDir, record);
  return record;
}

/** Remove a delegation from memory + disk (after cancel or when cascading chat delete). */
export function deleteDelegationRecord(workspaceDir: string, delegationId: string): boolean {
  const id = delegationId.trim();
  if (!id) {
    return false;
  }
  const record = registry.get(id);
  registry.delete(id);
  let deleted = false;
  const p = delegationFilePath(workspaceDir, id);
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      deleted = true;
    }
  } catch {
    /* best-effort */
  }
  // 同步清理 spill 的全文结果（.result.md），避免删除记录后残留结果文件。
  const relResult = record?.resultPath?.trim() || path.join(DELEGATIONS_DIR, `${id}.result.md`);
  const absResult = path.isAbsolute(relResult) ? relResult : path.join(workspaceDir, relResult);
  try {
    if (fs.existsSync(absResult)) {
      fs.unlinkSync(absResult);
    }
  } catch {
    /* best-effort */
  }
  return deleted;
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
  parentSessionId?: string;
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
  if (opts?.parentSessionId) {
    records = records.filter((r) => r.parentSessionId === opts.parentSessionId);
  }
  return records.toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * 供桌面轮询：某主会话下已终态的委派（含完整 result / error），按完成时间倒序。
 */
export function listDelegationFollowUpsForSession(opts: {
  parentSessionId: string;
  fromAssistantId: string;
}): DelegationRecord[] {
  const sid = opts.parentSessionId.trim();
  const aid = opts.fromAssistantId.trim();
  if (!sid || !aid) {
    return [];
  }
  return [...registry.values()]
    .filter((r) => r.parentSessionId === sid)
    .filter((r) => r.fromAssistantId === aid)
    .filter((r) => TERMINAL_DELEGATION_STATUSES.has(r.status))
    .toSorted((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt));
}

/** 供桌面轮询：某主会话下仍在执行的委派（含 targetSessionId）。 */
export function listRunningDelegationsForSession(opts: {
  parentSessionId: string;
  fromAssistantId: string;
}): DelegationRecord[] {
  const sid = opts.parentSessionId.trim();
  const aid = opts.fromAssistantId.trim();
  if (!sid || !aid) {
    return [];
  }
  return [...registry.values()]
    .filter((r) => r.parentSessionId === sid)
    .filter((r) => r.fromAssistantId === aid)
    .filter((r) => r.status === "pending" || r.status === "running")
    .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
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
