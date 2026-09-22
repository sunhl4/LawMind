/**
 * Serialize overlapping turns on the same session.
 *
 * In-process: queue overlapping POSTs (resume / automations / second window).
 * Cross-process: persist a lease under sessions/<id>.turn-gate.json so a
 * crashed or second desktop server cannot start a second turn on a live pid.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";

const tails = new Map<string, Promise<unknown>>();

/** Steal a live-pid lease older than this — pid reuse / stuck helper. */
export const TURN_GATE_STALE_MS = 3 * 60 * 60 * 1000;

export class SessionTurnInProgressError extends Error {
  readonly code = "SESSION_TURN_IN_PROGRESS";
  constructor(sessionId: string) {
    super(`SESSION_TURN_IN_PROGRESS: ${sessionId}`);
    this.name = "SessionTurnInProgressError";
  }
}

export function isSessionTurnInProgressError(err: unknown): err is SessionTurnInProgressError {
  return err instanceof SessionTurnInProgressError;
}

export type TurnGateLease = {
  pid: number;
  startedAt: string;
  hostname: string;
};

export function sessionTurnGateKey(workspaceDir: string, sessionId: string): string {
  return `${workspaceDir}\0${sessionId}`;
}

export function turnGateLeasePath(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, "sessions", `${sessionId}.turn-gate.json`);
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function shouldStealTurnGateLease(
  lease: TurnGateLease,
  nowMs: number,
  pidAlive: (pid: number) => boolean = isPidAlive,
): boolean {
  if (lease.pid === process.pid) {
    return true;
  }
  if (!pidAlive(lease.pid)) {
    return true;
  }
  const started = Date.parse(lease.startedAt);
  if (!Number.isFinite(started)) {
    return true;
  }
  return nowMs - started > TURN_GATE_STALE_MS;
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

/**
 * 是否存在**活着的**回合租约（跨进程的真相源）。
 *
 * `shouldStealTurnGateLease` 是「本进程可否抢租约」的判据（同 pid 即允许），
 * 不能用来判断「有没有别的回合在跑」。这里只看：租约在、持有者进程还活着、
 * 且没有超过陈旧上限。
 *
 * `ignoreOwnPid`：同进程**不算**活。恢复入口自己会先拿租约（`withSessionTurnGate`），
 * 若不忽略，刚拿到的租约会把「上一轮被中断」误判成「正在跑」。
 * 同进程的真实在跑另有 `getLiveTurnProgress` 作真相源。
 */
export function isSessionTurnLeaseLive(
  workspaceDir: string,
  sessionId: string,
  nowMs: number = Date.now(),
  opts?: { ignoreOwnPid?: boolean },
): boolean {
  const filePath = turnGateLeasePath(workspaceDir, sessionId);
  const lease = fs.existsSync(filePath) ? readLease(filePath) : null;
  if (!lease) {
    return false;
  }
  if (opts?.ignoreOwnPid === true && lease.pid === process.pid) {
    return false;
  }
  if (!isPidAlive(lease.pid)) {
    return false;
  }
  const started = Date.parse(lease.startedAt);
  if (!Number.isFinite(started)) {
    return true;
  }
  return nowMs - started <= TURN_GATE_STALE_MS;
}

/** Test helper: plant a lease without going through the gate. */
export function writeTurnGateLeaseForTest(
  workspaceDir: string,
  sessionId: string,
  lease: TurnGateLease,
): void {
  const filePath = turnGateLeasePath(workspaceDir, sessionId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonAtomic(filePath, lease);
}

function claimPersistedLease(workspaceDir: string, sessionId: string): void {
  const filePath = turnGateLeasePath(workspaceDir, sessionId);
  withExclusiveFileLock(`${filePath}.lock`, () => {
    const existing = fs.existsSync(filePath) ? readLease(filePath) : null;
    if (existing && !shouldStealTurnGateLease(existing, Date.now())) {
      throw new SessionTurnInProgressError(sessionId);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeJsonAtomic(filePath, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      hostname: os.hostname(),
    } satisfies TurnGateLease);
  });
}

function releasePersistedLease(workspaceDir: string, sessionId: string): void {
  const filePath = turnGateLeasePath(workspaceDir, sessionId);
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

export async function withSessionTurnGate<T>(
  workspaceDir: string,
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = sessionTurnGateKey(workspaceDir, sessionId);
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
    claimPersistedLease(workspaceDir, sessionId);
    try {
      return await fn();
    } finally {
      releasePersistedLease(workspaceDir, sessionId);
    }
  } finally {
    release();
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  }
}
