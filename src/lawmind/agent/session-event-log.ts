/**
 * Append-only session turn event log (parallel to session.json).
 * Structural events only — token deltas stay on the live SSE stream.
 */

import fs from "node:fs";
import path from "node:path";
import { withExclusiveFileLock } from "../adapters/matter-storage/io.js";
import {
  ensureLocalFileSync,
  installIcloudReadMaterialize,
} from "../runtime/icloud-materialize.js";
import {
  applyLiveTurnEvent,
  beginLiveTurnProgress,
  clearLiveTurnProgress,
  getLiveTurnProgress,
  type LiveTurnProgress,
} from "./live-turn-progress.js";
import { persistOrThrow } from "./session-persist.js";
import type { RunTurnEvent } from "./turn-orchestrator-events.js";

installIcloudReadMaterialize();

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

/** Replay only needs the latest turn. Larger logs are tailed so a restart poll does not reread years of events. */
export const SESSION_EVENT_REPLAY_TAIL_BYTES = 256 * 1024;

/**
 * A crash mid-append leaves a partial JSON line. The next append would glue onto it
 * and lose both the torn line and the new record. Drop back to the last newline first.
 */
export function repairTornJsonlTail(filePath: string): void {
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return;
  }
  if (size === 0) {
    return;
  }
  try {
    ensureLocalFileSync(filePath);
  } catch {
    return;
  }
  const fd = fs.openSync(filePath, "r+");
  try {
    const last = Buffer.alloc(1);
    fs.readSync(fd, last, 0, 1, size - 1);
    if (last[0] === 0x0a) {
      return;
    }
    const window = Math.min(size, 1024 * 1024);
    const buf = Buffer.alloc(window);
    const start = size - window;
    fs.readSync(fd, buf, 0, window, start);
    let cut = 0;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i] === 0x0a) {
        cut = start + i + 1;
        break;
      }
    }
    // 窗口内找不到换行（单条事件超过窗口）时不能截到 0——那会把整份事件日志清空。
    // 放弃本次修复：读侧 parseEventLines 本来就跳过坏行，损失止于撕尾那一条。
    if (cut > 0) {
      fs.ftruncateSync(fd, cut);
    }
  } finally {
    fs.closeSync(fd);
  }
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
    withExclusiveFileLock(`${filePath}.lock`, () => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      repairTornJsonlTail(filePath);
      const fd = fs.openSync(filePath, "a");
      try {
        fs.writeSync(fd, `${JSON.stringify(record)}\n`);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    });
  });
}

export function readSessionEvents(
  workspaceDir: string,
  sessionId: string,
): SessionEventLogRecord[] {
  const filePath = sessionEventsPath(workspaceDir, sessionId);
  try {
    ensureLocalFileSync(filePath);
    return parseEventLines(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

/** Last turn only, from the tail of a large log. Falls back to the full file when the tail has no turn_begin. */
export function readSessionEventsForReplay(
  workspaceDir: string,
  sessionId: string,
): SessionEventLogRecord[] {
  const filePath = sessionEventsPath(workspaceDir, sessionId);
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return [];
  }
  if (size <= SESSION_EVENT_REPLAY_TAIL_BYTES) {
    return readSessionEvents(workspaceDir, sessionId);
  }
  try {
    ensureLocalFileSync(filePath);
  } catch {
    return [];
  }
  const fd = fs.openSync(filePath, "r");
  try {
    const start = size - SESSION_EVENT_REPLAY_TAIL_BYTES;
    const buf = Buffer.alloc(SESSION_EVENT_REPLAY_TAIL_BYTES);
    fs.readSync(fd, buf, 0, SESSION_EVENT_REPLAY_TAIL_BYTES, start);
    const text = buf.toString("utf8");
    const nl = text.indexOf("\n");
    const body = nl >= 0 ? text.slice(nl + 1) : text;
    const parsed = parseEventLines(body);
    if (parsed.some((row) => row.event.type === "turn_begin")) {
      return parsed;
    }
  } finally {
    fs.closeSync(fd);
  }
  return readSessionEvents(workspaceDir, sessionId);
}

function parseEventLines(raw: string): SessionEventLogRecord[] {
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
  const records = readSessionEventsForReplay(workspaceDir, sessionId);
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
