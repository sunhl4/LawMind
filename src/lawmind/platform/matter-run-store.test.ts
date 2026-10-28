import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendMatterRunEvent,
  createMatterRunOnDisk,
  escalateDueMatterRunWaits,
  listEscalatedMatterRunWaits,
  listMatterRuns,
  loadMatterRun,
  matterRunEventsPath,
  readMatterRunEvents,
  recoverInterruptedMatterRuns,
  resolveEscalatedMatterRunWait,
  resumeMatterRuns,
  saveMatterRun,
  wakeMatterRunsForEvent,
} from "./matter-run-store.js";
import {
  completeMatterRunStep,
  createMatterRun,
  startMatterRunStep,
  type MatterRun,
} from "./matter-run.js";

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-matter-run-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const T0 = "2026-10-27T04:00:00.000Z";
const T1 = "2026-10-27T04:01:00.000Z";
const T2 = "2026-10-27T04:02:00.000Z";
const T3 = "2026-10-27T04:03:00.000Z";

describe("MatterRun persistence", () => {
  it("stores one file per run under the matter and lists across matters", () => {
    const ws = tmpWs();
    createMatterRunOnDisk(ws, {
      matterId: "m-1",
      runId: "run_a",
      steps: [{ kind: "fetch" }],
      at: T0,
    });
    createMatterRunOnDisk(ws, {
      matterId: "m-2",
      runId: "run_b",
      steps: [{ kind: "fetch" }],
      at: T0,
    });

    expect(
      listMatterRuns(ws)
        .map((r) => r.runId)
        .toSorted(),
    ).toEqual(["run_a", "run_b"]);
    expect(listMatterRuns(ws, { matterId: "m-1" })).toHaveLength(1);
    expect(loadMatterRun(ws, "m-1", "run_a")?.status).toBe("pending");

    const events = readMatterRunEvents(ws, "m-1", "run_a");
    expect(events.map((e) => e.type)).toEqual(["run_created"]);
  });

  it("rejects unsafe run ids", () => {
    const ws = tmpWs();
    expect(() => loadMatterRun(ws, "m-1", "../escape")).toThrow(/unsafe matter run id/);
  });

  it("resumes steps in order, waits for an event, then finishes", () => {
    const ws = tmpWs();
    createMatterRunOnDisk(ws, {
      matterId: "m-1",
      runId: "run_flow",
      steps: [{ kind: "fetch" }, { kind: "draft" }, { kind: "send" }],
      at: T0,
    });
    let draftReady = false;
    const calls: string[] = [];
    const executors = {
      fetch: () => {
        calls.push("fetch");
        return { status: "done" as const, outputRefs: ["cases/m-1/client.pdf"] };
      },
      draft: () => {
        calls.push("draft");
        if (!draftReady) {
          return {
            status: "waiting" as const,
            wait: {
              reason: "client_documents" as const,
              eventKeys: ["matter:m-1"],
              dueAt: "2026-11-01T00:00:00.000Z",
            },
          };
        }
        return { status: "done" as const, outputRefs: ["matters/m-1/deliverables/draft.json"] };
      },
      send: () => {
        calls.push("send");
        return { status: "done" as const };
      },
    };

    return (async () => {
      const first = await resumeMatterRuns(ws, { executors, at: T1 });
      expect(first.stepsRun).toBe(2);
      expect(first.waiting).toBe(1);
      expect(calls).toEqual(["fetch", "draft"]);

      let stored = loadMatterRun(ws, "m-1", "run_flow")!;
      expect(stored.status).toBe("waiting");
      expect(stored.steps[0]?.status).toBe("done");
      expect(stored.steps[1]?.status).toBe("waiting");
      expect(stored.steps[1]?.wait?.eventKeys).toEqual(["matter:m-1"]);

      // 不相关的事件不能唤醒
      expect(wakeMatterRunsForEvent(ws, "matter:m-2", { at: T2 }).wokeStepIds).toEqual([]);
      expect(loadMatterRun(ws, "m-1", "run_flow")?.status).toBe("waiting");

      // 相关事件唤醒后，下一轮继续推进
      expect(wakeMatterRunsForEvent(ws, "matter:m-1", { at: T2 }).wokeStepIds).toEqual(["s2"]);
      draftReady = true;
      const second = await resumeMatterRuns(ws, { executors, at: T3 });
      expect(second.stepsRun).toBe(2);
      expect(calls).toEqual(["fetch", "draft", "draft", "send"]);

      stored = loadMatterRun(ws, "m-1", "run_flow")!;
      expect(stored.status).toBe("done");
      expect(stored.steps[1]?.outputRefs).toEqual(["matters/m-1/deliverables/draft.json"]);

      const events = readMatterRunEvents(ws, "m-1", "run_flow").map((e) => e.type);
      expect(events).toContain("step_woken");
      expect(events).toContain("step_done");
    })();
  });

  it("never re-runs done steps after a restart", async () => {
    const ws = tmpWs();
    createMatterRunOnDisk(ws, {
      matterId: "m-1",
      runId: "run_once",
      steps: [{ kind: "render" }],
      at: T0,
    });
    let calls = 0;
    const executors = {
      render: () => {
        calls += 1;
        return { status: "done" as const };
      },
    };
    await resumeMatterRuns(ws, { executors, at: T1 });
    expect(calls).toBe(1);
    expect(loadMatterRun(ws, "m-1", "run_once")?.status).toBe("done");

    const again = await resumeMatterRuns(ws, { executors, at: T2 });
    expect(again.stepsRun).toBe(0);
    expect(calls).toBe(1);
  });

  it("replays a step that was running when the process died, with the same idempotency key", async () => {
    const ws = tmpWs();
    const base = createMatterRunOnDisk(ws, {
      matterId: "m-1",
      runId: "run_crash",
      steps: [{ kind: "send" }],
      at: T0,
    });
    // 模拟：领取步骤、落盘 running 之后进程被 kill -9。
    const claimed = startMatterRunStep(base, "s1", { at: T1, ownerPid: 999_999 });
    saveMatterRun(ws, claimed);
    appendMatterRunEvent(ws, {
      at: T1,
      type: "step_started",
      runId: "run_crash",
      matterId: "m-1",
      stepId: "s1",
      attempts: 1,
    });
    expect(loadMatterRun(ws, "m-1", "run_crash")?.steps[0]?.status).toBe("running");

    const recovered = recoverInterruptedMatterRuns(ws, { at: T2 });
    expect(recovered.recoveredStepIds).toEqual(["s1"]);
    expect(loadMatterRun(ws, "m-1", "run_crash")?.steps[0]?.status).toBe("pending");

    const sentKeys: string[] = [];
    const executors = {
      send: (ctx: { step: { idempotencyKey: string } }) => {
        // 真实执行器必须按幂等键去重；这里用同一份「外发日志」模拟。
        if (!sentKeys.includes(ctx.step.idempotencyKey)) {
          sentKeys.push(ctx.step.idempotencyKey);
        }
        return { status: "done" as const, outputRefs: ["outbox/1.eml"] };
      },
    };
    await resumeMatterRuns(ws, { executors, at: T3 });
    expect(sentKeys).toEqual(["run_crash:s1"]);

    const stored = loadMatterRun(ws, "m-1", "run_crash")!;
    expect(stored.status).toBe("done");
    expect(stored.steps[0]?.attempts).toBe(2);
    const events = readMatterRunEvents(ws, "m-1", "run_crash").map((e) => e.type);
    expect(events.filter((t) => t === "step_started")).toHaveLength(2);
    expect(events.filter((t) => t === "step_done")).toHaveLength(1);
  });

  it("does not double-execute when two resume passes overlap", async () => {
    const ws = tmpWs();
    createMatterRunOnDisk(ws, {
      matterId: "m-1",
      runId: "run_lock",
      steps: [{ kind: "slow" }],
      at: T0,
    });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executors = {
      slow: async () => {
        calls += 1;
        await gate;
        return { status: "done" as const };
      },
    };
    const a = resumeMatterRuns(ws, { executors, at: T1 });
    const b = resumeMatterRuns(ws, { executors, at: T1 });
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(loadMatterRun(ws, "m-1", "run_lock")?.status).toBe("done");
  });

  it("retries a failed step on the next pass instead of in the same tick", async () => {
    const ws = tmpWs();
    createMatterRunOnDisk(ws, {
      matterId: "m-1",
      runId: "run_retry",
      steps: [{ kind: "flaky", maxAttempts: 2 }],
      at: T0,
    });
    let calls = 0;
    const executors = {
      flaky: () => {
        calls += 1;
        return { status: "failed" as const, error: "temporary" };
      },
    };
    const first = await resumeMatterRuns(ws, { executors, at: T1 });
    expect(first.failed).toBe(1);
    expect(calls).toBe(1);
    let stored = loadMatterRun(ws, "m-1", "run_retry")!;
    expect(stored.steps[0]?.status).toBe("pending");
    expect(stored.steps[0]?.attempts).toBe(1);

    await resumeMatterRuns(ws, { executors, at: T2 });
    expect(calls).toBe(2);
    stored = loadMatterRun(ws, "m-1", "run_retry")!;
    expect(stored.steps[0]?.status).toBe("failed");
    expect(stored.status).toBe("failed");
  });

  it("leaves steps pending when no executor is registered", async () => {
    const ws = tmpWs();
    createMatterRunOnDisk(ws, {
      matterId: "m-1",
      runId: "run_blocked",
      steps: [{ kind: "unknown_kind" }],
      at: T0,
    });
    const first = await resumeMatterRuns(ws, { at: T1 });
    expect(first.blocked).toBe(1);
    expect(first.stepsRun).toBe(0);
    const stored = loadMatterRun(ws, "m-1", "run_blocked")!;
    expect(stored.steps[0]?.status).toBe("pending");
    expect(stored.steps[0]?.attempts).toBe(0);
  });

  it("escalates overdue waits into the lawyer todo list", async () => {
    const ws = tmpWs();
    createMatterRunOnDisk(ws, {
      matterId: "m-1",
      runId: "run_wait",
      steps: [{ kind: "wait_court" }],
      at: T0,
    });
    const executors = {
      wait_court: () => ({
        status: "waiting" as const,
        wait: {
          reason: "court_filing" as const,
          eventKeys: ["matter:m-1"],
          dueAt: "2026-10-28T00:00:00.000Z",
        },
      }),
    };
    await resumeMatterRuns(ws, { executors, at: T1 });
    expect(listEscalatedMatterRunWaits(ws)).toHaveLength(0);

    const escalated = escalateDueMatterRunWaits(ws, { at: "2026-10-29T00:00:00.000Z" });
    expect(escalated.escalatedStepIds).toEqual(["s1"]);
    expect(listEscalatedMatterRunWaits(ws)).toHaveLength(1);

    // 已升级的等待仍可被事件唤醒，不会卡死
    expect(
      wakeMatterRunsForEvent(ws, "matter:m-1", { at: "2026-10-29T01:00:00.000Z" }).wokeStepIds,
    ).toEqual(["s1"]);
    expect(loadMatterRun(ws, "m-1", "run_wait")?.steps[0]?.status).toBe("pending");
  });

  it("writes a replayable event log", () => {
    const ws = tmpWs();
    const run = createMatterRun({
      matterId: "m-1",
      runId: "run_events",
      steps: [{ kind: "a" }],
      at: T0,
    });
    saveMatterRun(ws, run);
    expect(fs.existsSync(matterRunEventsPath(ws, "m-1", "run_events"))).toBe(false);
    let next: MatterRun = startMatterRunStep(run, "s1", { at: T1 });
    next = completeMatterRunStep(next, "s1", { at: T2, outputRefs: ["out/a.md"] });
    saveMatterRun(ws, next);
    expect(loadMatterRun(ws, "m-1", "run_events")?.steps[0]?.outputRefs).toEqual(["out/a.md"]);
  });
});

describe("waits that timed out and reached the lawyer", () => {
  /** 一个已升级的等待步骤：等在法院立案，到期 10-28，10-29 升级。 */
  async function escalatedRun(ws: string): Promise<void> {
    createMatterRunOnDisk(ws, {
      matterId: "m-1",
      runId: "run_wait",
      steps: [{ kind: "wait_court", title: "等法院立案" }],
      at: T0,
    });
    await resumeMatterRuns(ws, {
      executors: {
        wait_court: () => ({
          status: "waiting" as const,
          wait: {
            reason: "court_filing" as const,
            eventKeys: ["matter:m-1"],
            dueAt: "2026-10-28T00:00:00.000Z",
          },
        }),
      },
      at: T1,
    });
    escalateDueMatterRunWaits(ws, { at: "2026-10-29T00:00:00.000Z" });
  }

  it("extends the due date, clears the escalation, and stays wakeable", async () => {
    const ws = tmpWs();
    await escalatedRun(ws);
    expect(listEscalatedMatterRunWaits(ws)).toHaveLength(1);

    const result = resolveEscalatedMatterRunWait(ws, {
      matterId: "m-1",
      runId: "run_wait",
      stepId: "s1",
      action: "extend",
      days: 3,
      at: "2026-10-29T02:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    const stored = loadMatterRun(ws, "m-1", "run_wait")!;
    expect(stored.status).toBe("waiting");
    expect(stored.steps[0]?.status).toBe("waiting");
    expect(stored.steps[0]?.wait?.escalatedAt).toBeUndefined();
    expect(stored.steps[0]?.wait?.dueAt).toBe("2026-11-01T02:00:00.000Z");
    expect(listEscalatedMatterRunWaits(ws)).toHaveLength(0);
    expect(readMatterRunEvents(ws, "m-1", "run_wait").map((e) => e.type)).toContain(
      "wait_extended",
    );

    // 提前到达的事件照样唤醒，不等新的到期日
    expect(wakeMatterRunsForEvent(ws, "matter:m-1", { at: T2 }).wokeStepIds).toEqual(["s1"]);
    expect(loadMatterRun(ws, "m-1", "run_wait")?.steps[0]?.status).toBe("pending");
  });

  it("skips the step and lets the run reach its end", async () => {
    const ws = tmpWs();
    await escalatedRun(ws);

    const result = resolveEscalatedMatterRunWait(ws, {
      matterId: "m-1",
      runId: "run_wait",
      stepId: "s1",
      action: "skip",
      at: "2026-10-29T02:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    const stored = loadMatterRun(ws, "m-1", "run_wait")!;
    expect(stored.steps[0]?.status).toBe("skipped");
    expect(stored.steps[0]?.wait).toBeUndefined();
    expect(stored.status).toBe("done");
    expect(listEscalatedMatterRunWaits(ws)).toHaveLength(0);
    const skipped = readMatterRunEvents(ws, "m-1", "run_wait").find(
      (e) => e.type === "step_skipped",
    );
    expect(skipped?.detail).toContain("不再等");
  });

  it("refuses waits that have not reached the lawyer yet", async () => {
    const ws = tmpWs();
    createMatterRunOnDisk(ws, {
      matterId: "m-1",
      runId: "run_pending_wait",
      steps: [{ kind: "wait_client" }],
      at: T0,
    });
    await resumeMatterRuns(ws, {
      executors: {
        wait_client: () => ({
          status: "waiting" as const,
          wait: {
            reason: "client_documents" as const,
            eventKeys: ["intake:*"],
            dueAt: "2026-11-05T00:00:00.000Z",
          },
        }),
      },
      at: T1,
    });

    const result = resolveEscalatedMatterRunWait(ws, {
      matterId: "m-1",
      runId: "run_pending_wait",
      stepId: "s1",
      action: "extend",
      at: T2,
    });
    expect(result).toEqual({ ok: false, reason: "step_not_escalated" });
    expect(loadMatterRun(ws, "m-1", "run_pending_wait")?.steps[0]?.wait?.dueAt).toBe(
      "2026-11-05T00:00:00.000Z",
    );
  });

  it("reports a missing run and clamps the extension to the ceiling", async () => {
    const ws = tmpWs();
    expect(
      resolveEscalatedMatterRunWait(ws, {
        matterId: "m-1",
        runId: "run_missing",
        stepId: "s1",
        action: "extend",
        at: T2,
      }),
    ).toEqual({ ok: false, reason: "run_not_found" });

    await escalatedRun(ws);
    const result = resolveEscalatedMatterRunWait(ws, {
      matterId: "m-1",
      runId: "run_wait",
      stepId: "s1",
      action: "extend",
      days: 90,
      at: "2026-10-29T02:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(loadMatterRun(ws, "m-1", "run_wait")?.steps[0]?.wait?.dueAt).toBe(
      "2026-11-28T02:00:00.000Z",
    );
  });
});
