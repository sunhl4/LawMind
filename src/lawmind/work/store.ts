/**
 * LawyerWork overlay index. W1 writes sidecar JSON next to sessions/tasks;
 * it does not replace session.json.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";
import type {
  LawyerWork,
  LawyerWorkEvent,
  LawyerWorkSource,
  LawyerWorkStatus,
  LawyerWorkUpsertInput,
} from "./types.js";

const WORKS_DIR = path.join("lawmind", "works");

const STATUS_RANK: Record<LawyerWorkStatus, number> = {
  open: 0,
  running: 1,
  needs_signoff: 2,
  done: 3,
  rejected: 3,
};

export function worksDir(workspaceDir: string): string {
  return path.join(workspaceDir, WORKS_DIR);
}

export function workRecordPath(workspaceDir: string, workId: string): string {
  return path.join(worksDir(workspaceDir), `${workId}.json`);
}

export function workEventsPath(workspaceDir: string, workId: string): string {
  return path.join(worksDir(workspaceDir), `${workId}.events.jsonl`);
}

function isWorkId(raw: string): boolean {
  return /^w_[0-9a-fA-F-]{8,}$/.test(raw.trim());
}

function asWork(raw: unknown): LawyerWork | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const rec = raw as Partial<LawyerWork>;
  if (typeof rec.workId !== "string" || !rec.workId.trim()) {
    return null;
  }
  if (typeof rec.title !== "string" || typeof rec.goal !== "string") {
    return null;
  }
  return {
    workId: rec.workId,
    title: rec.title,
    goal: rec.goal,
    status: rec.status ?? "open",
    sessionId: rec.sessionId,
    taskId: rec.taskId,
    draftId: rec.draftId,
    matterId: rec.matterId,
    capabilityId: rec.capabilityId,
    source: rec.source ?? "chat",
    createdAt: rec.createdAt ?? new Date().toISOString(),
    updatedAt: rec.updatedAt ?? rec.createdAt ?? new Date().toISOString(),
  };
}

export function mergeWorkStatus(
  prev: LawyerWorkStatus | undefined,
  next: LawyerWorkStatus,
): LawyerWorkStatus {
  if (!prev) {
    return next;
  }
  if (prev === "done" || prev === "rejected") {
    return prev;
  }
  return STATUS_RANK[next] >= STATUS_RANK[prev] ? next : prev;
}

export function readLawyerWork(workspaceDir: string, workId: string): LawyerWork | null {
  const id = workId.trim();
  if (!id || !isWorkId(id)) {
    return null;
  }
  const file = workRecordPath(workspaceDir, id);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return asWork(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

export function listLawyerWorks(workspaceDir: string): LawyerWork[] {
  const dir = worksDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: LawyerWork[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name.endsWith(".pending-goal.json")) {
      continue;
    }
    const id = name.slice(0, -".json".length);
    const work = readLawyerWork(workspaceDir, id);
    if (work) {
      out.push(work);
    }
  }
  return out.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function findLawyerWork(
  workspaceDir: string,
  query: {
    workId?: string;
    sessionId?: string;
    taskId?: string;
  },
): LawyerWork | null {
  if (query.workId) {
    const byId = readLawyerWork(workspaceDir, query.workId);
    if (byId) {
      return byId;
    }
  }
  const sessionId = query.sessionId?.trim();
  const taskId = query.taskId?.trim();
  if (!sessionId && !taskId) {
    return null;
  }
  for (const work of listLawyerWorks(workspaceDir)) {
    if (sessionId && work.sessionId === sessionId) {
      return work;
    }
    if (taskId && work.taskId === taskId) {
      return work;
    }
  }
  return null;
}

export function appendWorkEvent(
  workspaceDir: string,
  workId: string,
  event: Omit<LawyerWorkEvent, "at"> & { at?: string },
): void {
  const file = workEventsPath(workspaceDir, workId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = JSON.stringify({
    ...event,
    at: event.at ?? new Date().toISOString(),
  });
  fs.appendFileSync(file, `${line}\n`, "utf8");
}

export function writeLawyerWork(workspaceDir: string, work: LawyerWork): LawyerWork {
  const next: LawyerWork = { ...work, updatedAt: new Date().toISOString() };
  const file = workRecordPath(workspaceDir, next.workId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  withExclusiveFileLock(`${file}.lock`, () => {
    writeJsonAtomic(file, next);
  });
  return next;
}

export function createLawyerWork(
  workspaceDir: string,
  input: Omit<LawyerWorkUpsertInput, "workId"> & { title: string; source: LawyerWorkSource },
): LawyerWork {
  const now = new Date().toISOString();
  const work: LawyerWork = {
    workId: `w_${randomUUID()}`,
    title: input.title.trim() || "本件",
    goal: input.goal?.trim() ?? "",
    status: input.status ?? "open",
    sessionId: input.sessionId?.trim() || undefined,
    taskId: input.taskId?.trim() || undefined,
    draftId: input.draftId?.trim() || undefined,
    matterId: input.matterId?.trim() || undefined,
    capabilityId: input.capabilityId,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
  writeLawyerWork(workspaceDir, work);
  appendWorkEvent(workspaceDir, work.workId, {
    type: "work_opened",
    source: work.source,
    sessionId: work.sessionId,
    goal: work.goal,
  });
  return work;
}

export function upsertLawyerWork(workspaceDir: string, input: LawyerWorkUpsertInput): LawyerWork {
  const existing = findLawyerWork(workspaceDir, {
    workId: input.workId,
    sessionId: input.sessionId,
    taskId: input.taskId,
  });
  if (!existing) {
    return createLawyerWork(workspaceDir, {
      title: input.title?.trim() || input.goal?.trim() || "本件",
      goal: input.goal,
      status: input.status ?? "open",
      sessionId: input.sessionId,
      taskId: input.taskId,
      draftId: input.draftId,
      matterId: input.matterId,
      capabilityId: input.capabilityId,
      source: input.source ?? "chat",
    });
  }
  const next: LawyerWork = {
    ...existing,
    title: input.title?.trim() || existing.title,
    goal: input.goal !== undefined ? input.goal.trim() : existing.goal,
    status: input.status ? mergeWorkStatus(existing.status, input.status) : existing.status,
    sessionId: input.sessionId?.trim() || existing.sessionId,
    taskId: input.taskId?.trim() || existing.taskId,
    draftId: input.draftId?.trim() || existing.draftId,
    matterId: input.matterId?.trim() || existing.matterId,
    capabilityId: input.capabilityId ?? existing.capabilityId,
    source: input.source ?? existing.source,
  };
  const written = writeLawyerWork(workspaceDir, next);
  appendWorkEvent(workspaceDir, written.workId, {
    type: "work_upserted",
    taskId: written.taskId,
    draftId: written.draftId,
    status: written.status,
  });
  return written;
}

/** Persist-seam helper: attach task/draft/session without inventing a second product. */
export function upsertLawyerWorkFromPersist(
  workspaceDir: string,
  input: LawyerWorkUpsertInput,
): LawyerWork | null {
  try {
    return upsertLawyerWork(workspaceDir, input);
  } catch {
    return null;
  }
}
