/**
 * Append-only session turn event log (parallel to session.json).
 * Structural events only — token deltas stay on the live SSE stream.
 */

import fs from "node:fs";
import path from "node:path";
import {
  applyLiveTurnEvent,
  beginLiveTurnProgress,
  clearLiveTurnProgress,
  getLiveTurnProgress,
  type LiveTurnProgress,
} from "./live-turn-progress.js";
import { persistOrThrow } from "./session-persist.js";
import type { RunTurnEvent } from "./turn-orchestrator-events.js";

export type SessionEventLogRecord = {
  t: string;
  turnId?: string;
  event: RunTurnEvent | { type: "turn_begin" };
};

export function sessionEventsPath(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, "sessions", `${sessionId}.events.jsonl`);
}

export function shouldPersistSessionEvent(event: RunTurnEvent | { type: "turn_begin" }): boolean {
  return event.type !== "delta";
}

export function appendSessionEvent(
  workspaceDir: string,
  sessionId: string,
  event: RunTurnEvent | { type: "turn_begin" },
  opts?: { turnId?: string },
): void {
  if (!shouldPersistSessionEvent(event)) {
    return;
  }
  const filePath = sessionEventsPath(workspaceDir, sessionId);
  const record: SessionEventLogRecord = {
    t: new Date().toISOString(),
    ...(opts?.turnId ? { turnId: opts.turnId } : {}),
    event,
  };
  persistOrThrow("events", () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  });
}

export function readSessionEvents(
  workspaceDir: string,
  sessionId: string,
): SessionEventLogRecord[] {
  const filePath = sessionEventsPath(workspaceDir, sessionId);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const out: SessionEventLogRecord[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as SessionEventLogRecord;
        if (
          parsed &&
          typeof parsed === "object" &&
          parsed.event &&
          typeof parsed.event.type === "string"
        ) {
          out.push(parsed);
        }
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function eventsForLastTurn(records: SessionEventLogRecord[]): SessionEventLogRecord[] {
  let start = 0;
  for (let i = 0; i < records.length; i++) {
    if (records[i]?.event.type === "turn_begin") {
      start = i;
    }
  }
  return records.slice(start);
}

export function replayLiveTurnFromEventRecords(
  sessionId: string,
  records: SessionEventLogRecord[],
): LiveTurnProgress | undefined {
  const slice = eventsForLastTurn(records);
  if (slice.length === 0) {
    return undefined;
  }
  beginLiveTurnProgress(sessionId);
  for (const row of slice) {
    if (row.event.type === "turn_begin") {
      continue;
    }
    applyLiveTurnEvent(sessionId, row.event);
  }
  return getLiveTurnProgress(sessionId);
}

/**
 * Prefer in-memory progress; if the process restarted mid/after a turn, rebuild from jsonl.
 * Uses a scratch key so replay does not clobber a live in-memory turn.
 */
export function getLiveTurnProgressOrReplay(
  workspaceDir: string,
  sessionId: string,
): LiveTurnProgress | undefined {
  const mem = getLiveTurnProgress(sessionId);
  if (mem) {
    return mem;
  }
  const records = readSessionEvents(workspaceDir, sessionId);
  if (records.length === 0) {
    return undefined;
  }
  const scratchId = `__replay__${sessionId}`;
  try {
    const replayed = replayLiveTurnFromEventRecords(scratchId, records);
    if (!replayed) {
      return undefined;
    }
    return { ...replayed, sessionId };
  } finally {
    clearLiveTurnProgress(scratchId);
  }
}
