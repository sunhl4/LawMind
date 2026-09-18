/**
 * Deadline Service — W3。
 *
 * 真相源：`workspace/matters/<matterId>/deadlines.jsonl`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  appendDeadline,
  readDeadlines,
  rewriteDeadlines,
  type DeadlineRecord,
} from "../../adapters/matter-storage/index.js";
import { matterDir, withExclusiveFileLock } from "../../adapters/matter-storage/io.js";
import {
  annotateDeskDeadlines,
  sanitizeDeadlineDependsOn,
  suggestDependsOnDeadlineId,
  type DeskDeadlineView,
} from "../../desk/deadline-chain.js";
import { deadlineIcsUid } from "../../desk/deadline-ics.js";
import { defaultRemindBeforeHours } from "../../desk/legal-event-extract.js";
import { attachDeadlineId, createMatterIfMissing } from "./matter-write-service.js";

export type RecordDeadlineInput = {
  matterId: string;
  title: string;
  dueAt: string;
  severity?: DeadlineRecord["severity"];
  source?: DeadlineRecord["source"];
  notes?: string;
  deadlineId?: string;
  eventKind?: DeadlineRecord["eventKind"];
  remindBeforeHours?: number;
  icsUid?: string;
  dependsOnDeadlineId?: string;
};

function omitDependsOn(record: DeadlineRecord): DeadlineRecord {
  const next = { ...record };
  delete next.dependsOnDeadlineId;
  return next;
}

function withSanitizedDependsOn(
  record: DeadlineRecord,
  existing: DeadlineRecord[],
): DeadlineRecord {
  const dependsOnDeadlineId = sanitizeDeadlineDependsOn(record, existing);
  if (!dependsOnDeadlineId) {
    return omitDependsOn(record);
  }
  return { ...record, dependsOnDeadlineId };
}

export function recordDeadline(
  workspaceDir: string,
  input: RecordDeadlineInput,
  opts?: { createMatterIfMissing?: boolean },
): DeadlineRecord {
  if (opts?.createMatterIfMissing !== false) {
    createMatterIfMissing(workspaceDir, { matterId: input.matterId });
  }
  const eventKind = input.eventKind;
  const lockPath = path.join(matterDir(workspaceDir, input.matterId), "deadlines.jsonl.lock");
  const record = withExclusiveFileLock(lockPath, () => {
    const existing = readDeadlines(workspaceDir, input.matterId);
    const drafted: DeadlineRecord = {
      deadlineId: input.deadlineId ?? randomUUID(),
      matterId: input.matterId,
      title: input.title,
      dueAt: input.dueAt,
      severity: input.severity ?? (eventKind === "hearing" ? "hard" : "soft"),
      source: input.source ?? "manual",
      status: "open",
      notes: input.notes,
      ...(eventKind ? { eventKind } : {}),
      remindBeforeHours: input.remindBeforeHours ?? defaultRemindBeforeHours(eventKind ?? "custom"),
      icsUid: input.icsUid,
      ...(input.dependsOnDeadlineId?.trim()
        ? { dependsOnDeadlineId: input.dependsOnDeadlineId.trim() }
        : {}),
    };
    const next = withSanitizedDependsOn(drafted, existing);
    next.icsUid = deadlineIcsUid(next);
    appendDeadline(workspaceDir, next);
    return next;
  });
  attachDeadlineId(workspaceDir, input.matterId, record.deadlineId);
  return record;
}

export type ConfirmExtractedDeadlineInput = {
  eventKind: NonNullable<DeadlineRecord["eventKind"]>;
  title: string;
  dueAt: string;
  notes?: string;
};

/**
 * Lawyer-confirmed extract → deadlines. Hearings first so 上诉期 in the same
 * batch can hang off the new 开庭. Never auto-chains 举证 to 开庭.
 */
export function recordConfirmedExtractEvents(
  workspaceDir: string,
  matterId: string,
  events: ConfirmExtractedDeadlineInput[],
): DeadlineRecord[] {
  const existing = listDeadlinesForMatter(workspaceDir, matterId);
  const hearingRecords: DeadlineRecord[] = [];
  for (const ev of events) {
    if (ev.eventKind !== "hearing") {
      continue;
    }
    hearingRecords.push(
      recordDeadline(workspaceDir, {
        matterId,
        title: ev.title,
        dueAt: ev.dueAt,
        eventKind: ev.eventKind,
        notes: ev.notes,
        source: "document_extract",
        remindBeforeHours: defaultRemindBeforeHours(ev.eventKind),
      }),
    );
  }
  const pool: DeadlineRecord[] = [...existing, ...hearingRecords];
  const otherRecords: DeadlineRecord[] = [];
  for (const ev of events) {
    if (ev.eventKind === "hearing") {
      continue;
    }
    const dependsOnDeadlineId = suggestDependsOnDeadlineId({
      eventKind: ev.eventKind,
      title: ev.title,
      dueAt: ev.dueAt,
      candidates: pool,
    });
    const rec = recordDeadline(workspaceDir, {
      matterId,
      title: ev.title,
      dueAt: ev.dueAt,
      eventKind: ev.eventKind,
      notes: ev.notes,
      source: "document_extract",
      remindBeforeHours: defaultRemindBeforeHours(ev.eventKind),
      dependsOnDeadlineId,
    });
    otherRecords.push(rec);
    pool.push(rec);
  }
  const hearingQ = [...hearingRecords];
  const otherQ = [...otherRecords];
  return events.map((ev) => (ev.eventKind === "hearing" ? hearingQ.shift()! : otherQ.shift()!));
}

export function snoozeDeadline(
  workspaceDir: string,
  matterId: string,
  deadlineId: string,
  newDueAt?: string,
): DeadlineRecord | undefined {
  return updateDeadlineStatus(workspaceDir, matterId, deadlineId, "snoozed", { dueAt: newDueAt });
}

export function completeDeadline(
  workspaceDir: string,
  matterId: string,
  deadlineId: string,
): DeadlineRecord | undefined {
  return updateDeadlineStatus(workspaceDir, matterId, deadlineId, "completed");
}

export function listDeadlinesForMatter(workspaceDir: string, matterId: string): DeadlineRecord[] {
  return readDeadlines(workspaceDir, matterId);
}

export function listDeskDeadlines(workspaceDir: string, matterId: string): DeskDeadlineView[] {
  return annotateDeskDeadlines(listDeadlinesForMatter(workspaceDir, matterId));
}

function updateDeadlineStatus(
  workspaceDir: string,
  matterId: string,
  deadlineId: string,
  status: DeadlineRecord["status"],
  opts?: { dueAt?: string },
): DeadlineRecord | undefined {
  const lockPath = path.join(matterDir(workspaceDir, matterId), "deadlines.jsonl.lock");
  return withExclusiveFileLock(lockPath, () => {
    const all = readDeadlines(workspaceDir, matterId);
    const idx = all.findIndex((d) => d.deadlineId === deadlineId);
    if (idx < 0) {
      return undefined;
    }
    const next: DeadlineRecord = {
      ...all[idx],
      status,
      dueAt: opts?.dueAt ?? all[idx].dueAt,
    };
    all[idx] = next;
    rewriteDeadlines(workspaceDir, matterId, all);
    return next;
  });
}

/** Remove deadlines by id (desk revert). Detaches matter.deadlineIds via caller. */
export function removeDeadlines(
  workspaceDir: string,
  matterId: string,
  deadlineIds: string[],
): number {
  if (deadlineIds.length === 0) {
    return 0;
  }
  const drop = new Set(deadlineIds);
  const lockPath = path.join(matterDir(workspaceDir, matterId), "deadlines.jsonl.lock");
  return withExclusiveFileLock(lockPath, () => {
    const all = readDeadlines(workspaceDir, matterId);
    const next = all.filter((d) => !drop.has(d.deadlineId));
    const removed = all.length - next.length;
    if (removed > 0) {
      rewriteDeadlines(workspaceDir, matterId, next);
    }
    return removed;
  });
}

export function patchDeadline(
  workspaceDir: string,
  matterId: string,
  deadlineId: string,
  patch: Partial<
    Pick<
      DeadlineRecord,
      | "status"
      | "dueAt"
      | "notes"
      | "remindedAt"
      | "remindBeforeHours"
      | "title"
      | "dependsOnDeadlineId"
    >
  >,
): DeadlineRecord | undefined {
  const lockPath = path.join(matterDir(workspaceDir, matterId), "deadlines.jsonl.lock");
  return withExclusiveFileLock(lockPath, () => {
    const all = readDeadlines(workspaceDir, matterId);
    const idx = all.findIndex((d) => d.deadlineId === deadlineId);
    if (idx < 0) {
      return undefined;
    }
    const merged: DeadlineRecord = {
      ...all[idx],
      ...patch,
    };
    if (patch.dependsOnDeadlineId !== undefined) {
      const next = withSanitizedDependsOn(
        { ...merged, dependsOnDeadlineId: patch.dependsOnDeadlineId },
        all.filter((row) => row.deadlineId !== deadlineId),
      );
      all[idx] = next;
      rewriteDeadlines(workspaceDir, matterId, all);
      return next;
    }
    all[idx] = merged;
    rewriteDeadlines(workspaceDir, matterId, all);
    return merged;
  });
}

export type { DeadlineRecord, DeskDeadlineView };
