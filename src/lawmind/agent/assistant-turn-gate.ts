/**
 * Serialize overlapping turns for the same assistant (B3 execution slot).
 *
 * Session turn gate alone is not enough: two sessions under one assistant can
 * still race shared Word / 法宝 / host tool state. Mirror session-turn-gate:
 * in-process queue + persisted lease under sessions/assistant-<id>.turn-gate.json.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { DEFAULT_ASSISTANT_ID } from "../assistants/constants.js";
import {
  isForeignTurnGateHost,
  isPidAlive,
  shouldStealTurnGateLease,
  TURN_GATE_STALE_MS,
  type TurnGateLease,
} from "./session-turn-gate.js";

const tails = new Map<string, Promise<unknown>>();

const INVALID_ID = /[./\\]/;

function leaseIsStale(lease: TurnGateLease, nowMs: number): boolean {
  const started = Date.parse(lease.startedAt);
  if (!Number.isFinite(started)) {
    return true;
  }
  return nowMs - started > TURN_GATE_STALE_MS;
}

export class AssistantTurnInProgressError extends Error {
  readonly code = "ASSISTANT_TURN_IN_PROGRESS";
  constructor(assistantId: string) {
    super(`ASSISTANT_TURN_IN_PROGRESS: ${assistantId}`);
    this.name = "AssistantTurnInProgressError";
  }
}

export function isAssistantTurnInProgressError(err: unknown): err is AssistantTurnInProgressError {
  return err instanceof AssistantTurnInProgressError;
}

export function normalizeAssistantGateId(assistantId: string | undefined | null): string {
  const id = typeof assistantId === "string" ? assistantId.trim() : "";
  if (!id || INVALID_ID.test(id)) {
    return DEFAULT_ASSISTANT_ID;
  }
  return id;
}

export function assistantTurnGateKey(workspaceDir: string, assistantId: string): string {
  return `${workspaceDir}\0assistant:${normalizeAssistantGateId(assistantId)}`;
}

export function assistantTurnGateLeasePath(workspaceDir: string, assistantId: string): string {
  const id = normalizeAssistantGateId(assistantId);
  return path.join(workspaceDir, "sessions", `assistant-${id}.turn-gate.json`);
}

function readLease(filePath: string): TurnGateLease | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<TurnGateLease>;
    if (typeof raw.pid !== "number" || typeof raw.startedAt !== "string") {
      return null;
    }
    return {
      pid: raw.pid,
      startedAt: raw.startedAt,
      hostname: typeof raw.hostname === "string" ? raw.hostname : "",
    };
  } catch {
    return null;
  }
}

/** Test helper: plant a lease without going through the gate. */
export function writeAssistantTurnGateLeaseForTest(
  workspaceDir: string,
  assistantId: string,
  lease: TurnGateLease,
): void {
  const filePath = assistantTurnGateLeasePath(workspaceDir, assistantId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonAtomic(filePath, lease);
}

export function isAssistantTurnLeaseLive(
  workspaceDir: string,
  assistantId: string,
  nowMs: number = Date.now(),
  opts?: { ignoreOwnPid?: boolean },
): boolean {
  const filePath = assistantTurnGateLeasePath(workspaceDir, assistantId);
  const lease = fs.existsSync(filePath) ? readLease(filePath) : null;
  if (!lease) {
    return false;
  }
  if (opts?.ignoreOwnPid === true && lease.pid === process.pid && !isForeignTurnGateHost(lease)) {
    return false;
  }
  if (!isForeignTurnGateHost(lease) && !isPidAlive(lease.pid)) {
    return false;
  }
  return !leaseIsStale(lease, nowMs);
}

function claimPersistedLease(workspaceDir: string, assistantId: string): void {
  const id = normalizeAssistantGateId(assistantId);
  const filePath = assistantTurnGateLeasePath(workspaceDir, id);
  withExclusiveFileLock(`${filePath}.lock`, () => {
    const existing = fs.existsSync(filePath) ? readLease(filePath) : null;
    if (existing && !shouldStealTurnGateLease(existing, Date.now())) {
      throw new AssistantTurnInProgressError(id);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeJsonAtomic(filePath, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      hostname: os.hostname(),
    } satisfies TurnGateLease);
  });
}

function releasePersistedLease(workspaceDir: string, assistantId: string): void {
  const filePath = assistantTurnGateLeasePath(workspaceDir, assistantId);
  try {
    withExclusiveFileLock(`${filePath}.lock`, () => {
      const existing = readLease(filePath);
      if (existing && existing.pid === process.pid && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  } catch {
    /* best-effort */
  }
}

export async function withAssistantTurnGate<T>(
  workspaceDir: string,
  assistantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const id = normalizeAssistantGateId(assistantId);
  const key = assistantTurnGateKey(workspaceDir, id);
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(
    () => held,
    () => held,
  );
  tails.set(key, tail);
  try {
    await prev.catch(() => undefined);
    claimPersistedLease(workspaceDir, id);
    try {
      return await fn();
    } finally {
      releasePersistedLease(workspaceDir, id);
    }
  } finally {
    release();
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  }
}
