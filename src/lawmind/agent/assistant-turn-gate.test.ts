import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assistantTurnGateLeasePath,
  AssistantTurnInProgressError,
  withAssistantTurnGate,
  writeAssistantTurnGateLeaseForTest,
} from "./assistant-turn-gate.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-asst-gate-"));
  dirs.push(ws);
  return ws;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("withAssistantTurnGate", () => {
  it("serializes overlapping work on the same assistant", async () => {
    const ws = tmpWs();
    const order: number[] = [];
    const first = withAssistantTurnGate(ws, "a1", async () => {
      order.push(1);
      await delay(25);
      order.push(2);
    });
    const second = withAssistantTurnGate(ws, "a1", async () => {
      order.push(3);
    });
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
    expect(fs.existsSync(assistantTurnGateLeasePath(ws, "a1"))).toBe(false);
  });

  it("allows different assistants to overlap", async () => {
    const ws = tmpWs();
    let concurrent = 0;
    let maxConcurrent = 0;
    const run = (assistantId: string) =>
      withAssistantTurnGate(ws, assistantId, async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(20);
        concurrent -= 1;
      });
    await Promise.all([run("alpha"), run("beta")]);
    expect(maxConcurrent).toBe(2);
  });

  it("refuses a live lease from another process", async () => {
    const ws = tmpWs();
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    const pid = child.pid;
    expect(pid).toBeTruthy();
    try {
      writeAssistantTurnGateLeaseForTest(ws, "busy", {
        pid: pid as number,
        startedAt: new Date().toISOString(),
        hostname: "other",
      });
      await expect(withAssistantTurnGate(ws, "busy", async () => "nope")).rejects.toBeInstanceOf(
        AssistantTurnInProgressError,
      );
    } finally {
      child.kill();
    }
  });

  it("steals a lease whose pid is dead", async () => {
    const ws = tmpWs();
    writeAssistantTurnGateLeaseForTest(ws, "dead", {
      pid: 999_999_991,
      startedAt: new Date().toISOString(),
      hostname: os.hostname(),
    });
    await expect(withAssistantTurnGate(ws, "dead", async () => "ok")).resolves.toBe("ok");
  });
});
