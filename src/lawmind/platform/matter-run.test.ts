import { describe, expect, it } from "vitest";
import {
  completeMatterRunStep,
  createMatterRun,
  escalateDueWaitSteps,
  failMatterRunStep,
  isMatterRunStepLeaseActive,
  matterRunProgress,
  nextRunnableMatterRunStep,
  recoverInterruptedMatterRun,
  startMatterRunStep,
  waitMatterRunStep,
  wakeMatterRunForEvent,
} from "./matter-run.js";

const T0 = "2026-10-27T04:00:00.000Z";
const T1 = "2026-10-27T04:01:00.000Z";
const T2 = "2026-10-27T04:02:00.000Z";

function sampleRun() {
  return createMatterRun({
    matterId: "m-1",
    runId: "run_test",
    steps: [
      { kind: "fetch", title: "取回客户补件" },
      { kind: "draft", title: "生成催告函" },
    ],
    at: T0,
  });
}

describe("MatterRun state machine", () => {
  it("creates sequential pending steps with stable idempotency keys", () => {
    const run = sampleRun();
    expect(run.status).toBe("pending");
    expect(run.steps.map((s) => s.stepId)).toEqual(["s1", "s2"]);
    expect(run.steps.map((s) => s.idempotencyKey)).toEqual(["run_test:s1", "run_test:s2"]);
    expect(run.steps.every((s) => s.attempts === 0)).toBe(true);
  });

  it("rejects duplicate step ids and duplicate idempotency keys", () => {
    expect(() =>
      createMatterRun({
        matterId: "m-1",
        steps: [
          { stepId: "same", kind: "a" },
          { stepId: "same", kind: "b" },
        ],
      }),
    ).toThrow(/duplicate_step_id/);
    expect(() =>
      createMatterRun({
        matterId: "m-1",
        steps: [
          { kind: "a", idempotencyKey: "k" },
          { kind: "b", idempotencyKey: "k" },
        ],
      }),
    ).toThrow(/duplicate_idempotency_key/);
    expect(() => createMatterRun({ matterId: "m-1", steps: [] })).toThrow(
      /matter_run_requires_steps/,
    );
  });

  it("runs one step at a time and memoizes done steps", () => {
    let run = sampleRun();
    expect(nextRunnableMatterRunStep(run)?.stepId).toBe("s1");

    run = startMatterRunStep(run, "s1", { at: T1, leaseMs: 60_000 });
    expect(run.status).toBe("running");
    expect(run.steps[0]?.attempts).toBe(1);
    expect(isMatterRunStepLeaseActive(run.steps[0], { now: T1, pid: process.pid })).toBe(true);
    // 步骤一没完成时不得抢跑步骤二
    expect(nextRunnableMatterRunStep(run)?.stepId).toBe("s1");

    run = completeMatterRunStep(run, "s1", { at: T1, outputRefs: ["cases/m-1/a.pdf"] });
    expect(run.steps[0]?.status).toBe("done");
    expect(run.steps[0]?.outputRefs).toEqual(["cases/m-1/a.pdf"]);
    expect(nextRunnableMatterRunStep(run)?.stepId).toBe("s2");

    run = startMatterRunStep(run, "s2", { at: T2 });
    run = completeMatterRunStep(run, "s2", { at: T2 });
    expect(run.status).toBe("done");
    expect(run.finishedAt).toBe(T2);
    expect(matterRunProgress(run)).toMatchObject({ total: 2, done: 2, pending: 0 });
  });

  it("persists waiting and wakes only on a matching event key", () => {
    let run = sampleRun();
    run = startMatterRunStep(run, "s1", { at: T1 });
    run = waitMatterRunStep(
      run,
      "s1",
      { reason: "client_documents", eventKeys: ["matter:m-1"], dueAt: "2026-11-01T00:00:00.000Z" },
      T1,
    );
    expect(run.status).toBe("waiting");
    expect(nextRunnableMatterRunStep(run)).toBeUndefined();

    const unrelated = wakeMatterRunForEvent(run, "matter:m-2", T2);
    expect(unrelated.wokeStepIds).toEqual([]);
    expect(unrelated.run).toBe(run);

    const woken = wakeMatterRunForEvent(run, "matter:m-1", T2);
    expect(woken.wokeStepIds).toEqual(["s1"]);
    expect(woken.run.steps[0]?.status).toBe("pending");
    expect(woken.run.status).toBe("pending");
    expect(nextRunnableMatterRunStep(woken.run)?.stepId).toBe("s1");
  });

  it("escalates overdue waits once, without losing the waiting state", () => {
    let run = sampleRun();
    run = startMatterRunStep(run, "s1", { at: T1 });
    run = waitMatterRunStep(
      run,
      "s1",
      { reason: "court_filing", eventKeys: ["matter:m-1"], dueAt: "2026-10-28T00:00:00.000Z" },
      T1,
    );

    const tooEarly = escalateDueWaitSteps(run, { now: T2 });
    expect(tooEarly.escalatedStepIds).toEqual([]);

    const due = escalateDueWaitSteps(run, { now: "2026-10-29T00:00:00.000Z" });
    expect(due.escalatedStepIds).toEqual(["s1"]);
    expect(due.run.steps[0]?.wait?.escalatedAt).toBe("2026-10-29T00:00:00.000Z");
    expect(due.run.status).toBe("waiting");
    expect(matterRunProgress(due.run).escalated).toBe(1);

    const again = escalateDueWaitSteps(due.run, { now: "2026-10-30T00:00:00.000Z" });
    expect(again.escalatedStepIds).toEqual([]);
  });

  it("retries retryable failures until maxAttempts, then fails the run", () => {
    let run = createMatterRun({
      matterId: "m-1",
      runId: "run_retry",
      steps: [{ kind: "send", maxAttempts: 2 }],
      at: T0,
    });
    run = startMatterRunStep(run, "s1", { at: T1 });
    run = failMatterRunStep(run, "s1", { error: "smtp down", at: T1 });
    expect(run.steps[0]?.status).toBe("pending");
    expect(run.steps[0]?.error).toBe("smtp down");

    run = startMatterRunStep(run, "s1", { at: T2 });
    run = failMatterRunStep(run, "s1", { error: "smtp still down", at: T2 });
    expect(run.steps[0]?.status).toBe("failed");
    expect(run.status).toBe("failed");
  });

  it("does not retry non-retryable failures", () => {
    let run = sampleRun();
    run = startMatterRunStep(run, "s1", { at: T1 });
    run = failMatterRunStep(run, "s1", { error: "bad input", at: T1, retryable: false });
    expect(run.steps[0]?.status).toBe("failed");
    expect(run.status).toBe("failed");
  });

  it("recovers interrupted running steps, but marks exhausted attempts as failed", () => {
    let run = sampleRun();
    run = startMatterRunStep(run, "s1", { at: T1, leaseMs: 1_000 });
    expect(isMatterRunStepLeaseActive(run.steps[0], { now: T2, pid: -1 })).toBe(false);

    const recovered = recoverInterruptedMatterRun(run, T2);
    expect(recovered.recoveredStepIds).toEqual(["s1"]);
    expect(recovered.run.steps[0]?.status).toBe("pending");
    expect(recovered.run.status).toBe("pending");

    let exhausted = createMatterRun({
      matterId: "m-1",
      runId: "run_exhausted",
      steps: [{ kind: "send", maxAttempts: 1 }],
      at: T0,
    });
    exhausted = startMatterRunStep(exhausted, "s1", { at: T1 });
    const after = recoverInterruptedMatterRun(exhausted, T2);
    expect(after.exhaustedStepIds).toEqual(["s1"]);
    expect(after.run.steps[0]?.status).toBe("failed");
    expect(after.run.status).toBe("failed");
  });
});
