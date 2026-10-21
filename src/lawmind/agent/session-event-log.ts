/**
 * Append-only session turn event log (parallel to session.json).
 * Structural events only — token deltas stay on the live SSE stream.
 */

import fs from "node:fs";
import path from "node:path";
import { withExclusiveFileLock } from "../adapters/matter-storage/io.js";
import {
  applyLiveTurnEvent,
  beginLiveTurnProgress,
  clearLiveTurnProgress,
  getLiveTurnProgress,
  type LiveTurnProgress,
} from "./live-turn-progress.js";
import { persistOrThrow } from "./session-persist.js";
import { isSessionTurnLeaseLive } from "./session-turn-gate.js";
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
 *
 * 重启对账：日志里最后一轮有 `turn_begin` 却没有 `final`，说明进程在回合收口前退出。
 * 这时不能把 replay 出来的 `running` 当真——界会一直显示「在办」，与「上一轮被中断」
 * 的卡片自相矛盾。改为 `paused` + `needsReconcile`，并补一条律师可读的收尾说明；
 * 同一进程里另一实例仍在跑（租约活着）时不改写。
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
    const orphaned = isOrphanedReplay(workspaceDir, sessionId, records);
    return orphaned
      ? { ...replayed, sessionId, ...markReplayInterrupted(replayed) }
      : { ...replayed, sessionId };
  } finally {
    clearLiveTurnProgress(scratchId);
  }
}

/** 最后一轮没有 `final`，且没有别的进程持有租约 → 视为重启打断的回合。 */
function isOrphanedReplay(
  workspaceDir: string,
  sessionId: string,
  records: SessionEventLogRecord[],
): boolean {
  const slice = eventsForLastTurn(records);
  if (slice.length === 0) {
    return false;
  }
  if (slice.some((row) => row.event.type === "final")) {
    return false;
  }
  try {
    if (isSessionTurnLeaseLive(workspaceDir, sessionId)) {
      return false;
    }
  } catch {
    /* 租约读失败按「无活回合」处理：宁可提示对账，也不假装仍在跑 */
  }
  return true;
}

export const INTERRUPTED_REPLAY_LABEL = "上次办理在应用退出时中断，已办理的步骤保留";

function markReplayInterrupted(progress: LiveTurnProgress): Partial<LiveTurnProgress> {
  const steps = progress.steps.map((step) =>
    step.status === "running" ? { ...step, status: "paused" as const, detail: "等待核对" } : step,
  );
  if (!steps.some((step) => step.label === INTERRUPTED_REPLAY_LABEL)) {
    steps.push({
      id: "interrupted-by-restart",
      kind: "round",
      label: INTERRUPTED_REPLAY_LABEL,
      status: "paused",
      detail: "结果可能已落盘。请先核对，再决定继续本件或弃办。",
    });
  }
  return { status: "paused", needsReconcile: true, steps };
}
