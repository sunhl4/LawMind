import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SessionTurnInProgressError,
  TURN_GATE_STALE_MS,
  shouldStealTurnGateLease,
  turnGateLeasePath,
  withSessionTurnGate,
  writeTurnGateLeaseForTest,
} from "./session-turn-gate.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-turn-gate-"));
  dirs.push(ws);
  return ws;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("withSessionTurnGate", () => {
  it("serializes overlapping work on the same session", async () => {
    const ws = tmpWs();
    const order: number[] = [];
    const first = withSessionTurnGate(ws, "s1", async () => {
      order.push(1);
      await delay(25);
      order.push(2);
    });
    const second = withSessionTurnGate(ws, "s1", async () => {
      order.push(3);
    });
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
    expect(fs.existsSync(turnGateLeasePath(ws, "s1"))).toBe(false);
  });

  it("allows different sessions to overlap", async () => {
    const ws = tmpWs();
    let concurrent = 0;
    let maxConcurrent = 0;
    const run = (sessionId: string) =>
      withSessionTurnGate(ws, sessionId, async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(20);
        concurrent -= 1;
      });
    await Promise.all([run("a"), run("b")]);
    expect(maxConcurrent).toBe(2);
  });

  it("refuses a live lease from another process", async () => {
    const ws = tmpWs();
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    const pid = child.pid;
    expect(pid).toBeTruthy();
    try {
      writeTurnGateLeaseForTest(ws, "s-live", {
        pid: pid as number,
        startedAt: new Date().toISOString(),
        hostname: "other",
      });
      await expect(withSessionTurnGate(ws, "s-live", async () => "nope")).rejects.toBeInstanceOf(
        SessionTurnInProgressError,
      );
    } finally {
      child.kill();
    }
  });

  it("steals a lease whose pid is dead", async () => {
    const ws = tmpWs();
    writeTurnGateLeaseForTest(ws, "s-dead", {
      pid: 999_999_991,
      startedAt: new Date().toISOString(),
      hostname: "gone",
    });
    await expect(withSessionTurnGate(ws, "s-dead", async () => "ok")).resolves.toBe("ok");
  });
});

describe("shouldStealTurnGateLease", () => {
  it("steals dead, stale, or same-pid leases", () => {
    const now = Date.parse("2026-08-23T01:00:00.000Z");
    expect(
      shouldStealTurnGateLease(
        { pid: 9, startedAt: "2026-08-23T00:59:00.000Z", hostname: "x" },
        now,
        () => false,
      ),
    ).toBe(true);
    expect(
      shouldStealTurnGateLease(
        { pid: 9, startedAt: "2026-08-23T00:59:00.000Z", hostname: "x" },
        now,
        () => true,
      ),
    ).toBe(false);
    expect(
      shouldStealTurnGateLease(
        { pid: 9, startedAt: new Date(now - TURN_GATE_STALE_MS - 1).toISOString(), hostname: "x" },
        now,
        () => true,
      ),
    ).toBe(true);
    expect(
      shouldStealTurnGateLease(
        { pid: process.pid, startedAt: "2026-08-23T00:59:00.000Z", hostname: "x" },
        now,
        () => true,
      ),
    ).toBe(true);
  });
});
