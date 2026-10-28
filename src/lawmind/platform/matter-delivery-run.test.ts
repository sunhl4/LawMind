import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDeliveryRunSteps,
  createDeliveryRunOnDisk,
  deliveryRunId,
  deliveryRunRefs,
  shouldCreateDeliveryRun,
  DELIVERY_RUN_STEP_KINDS,
} from "./matter-delivery-run.js";
import {
  loadMatterRun,
  resumeMatterRuns,
  wakeMatterRunsForEvent,
  type MatterRunStepExecutor,
} from "./matter-run-store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-delivery-run-"));
  dirs.push(dir);
  return dir;
}

function executors(overrides: Partial<Record<string, MatterRunStepExecutor>> = {}) {
  const base: Record<string, MatterRunStepExecutor> = {
    [DELIVERY_RUN_STEP_KINDS.waitJob]: async () => ({
      status: "waiting",
      wait: {
        reason: "external_event",
        eventKeys: ["job:job-1"],
        dueAt: "2026-10-29T00:00:00.000Z",
      },
    }),
    [DELIVERY_RUN_STEP_KINDS.collect]: async () => ({
      status: "done",
      cursor: { draftTaskIds: ["task-1"], primaryTaskId: "task-1" },
      outputRefs: ["draft:task-1"],
    }),
    [DELIVERY_RUN_STEP_KINDS.render]: async () => ({
      status: "done",
      outputRefs: ["rendered:task-1"],
    }),
    [DELIVERY_RUN_STEP_KINDS.outboundPrepare]: async () => ({
      status: "done",
      outputRefs: ["inbox:item-1"],
    }),
  };
  return { ...base, ...overrides };
}

describe("delivery run", () => {
  it("builds four stable steps with input refs and idempotency keys", () => {
    const steps = buildDeliveryRunSteps({
      matterId: "matter-1",
      jobId: "job-1",
      automationId: "auto-1",
    });
    expect(steps.map((step) => step.stepId)).toEqual(["wait_job", "collect", "render", "outbound"]);
    expect(steps.map((step) => step.kind)).toEqual([
      DELIVERY_RUN_STEP_KINDS.waitJob,
      DELIVERY_RUN_STEP_KINDS.collect,
      DELIVERY_RUN_STEP_KINDS.render,
      DELIVERY_RUN_STEP_KINDS.outboundPrepare,
    ]);
    expect(steps[0]?.inputRefs).toEqual(["job:job-1", "automation:auto-1"]);
    expect(deliveryRunRefs(steps[0] ?? {})).toEqual({ jobId: "job-1", automationId: "auto-1" });
  });

  it("creates one run per job and reuses it on replay", () => {
    const dir = workspace();
    const first = createDeliveryRunOnDisk(dir, {
      matterId: "matter-1",
      jobId: "job-1",
      automationId: "auto-1",
      title: "邮件合同审阅",
    });
    expect(first.runId).toBe(deliveryRunId("job-1"));
    expect(first.steps).toHaveLength(4);
    expect(first.steps[0]?.idempotencyKey).toBe(`${first.runId}:wait_job`);

    const second = createDeliveryRunOnDisk(dir, {
      matterId: "matter-1",
      jobId: "job-1",
      automationId: "auto-1",
      title: "邮件合同审阅",
    });
    expect(second.runId).toBe(first.runId);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.steps.map((step) => step.status)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("waits on the job event, then runs collect/render/outbound after wake", async () => {
    const dir = workspace();
    const run = createDeliveryRunOnDisk(dir, {
      matterId: "matter-1",
      jobId: "job-1",
      automationId: "auto-1",
    });

    await resumeMatterRuns(dir, {
      matterId: "matter-1",
      runId: run.runId,
      executors: executors(),
      at: "2026-10-28T00:00:00.000Z",
    });
    const waiting = loadMatterRun(dir, "matter-1", run.runId);
    expect(waiting?.status).toBe("waiting");
    expect(waiting?.steps[0]?.status).toBe("waiting");
    expect(waiting?.steps[0]?.wait?.eventKeys).toEqual(["job:job-1"]);

    const woke = wakeMatterRunsForEvent(dir, "job:job-1", { at: "2026-10-28T01:00:00.000Z" });
    expect(woke.runIds).toEqual([run.runId]);
    expect(woke.wokeStepIds).toEqual(["wait_job"]);

    await resumeMatterRuns(dir, {
      matterId: "matter-1",
      runId: run.runId,
      executors: executors({
        [DELIVERY_RUN_STEP_KINDS.waitJob]: async () => ({
          status: "done",
          cursor: { jobStatus: "completed" },
          outputRefs: ["job:job-1"],
        }),
      }),
      at: "2026-10-28T01:00:01.000Z",
    });
    const done = loadMatterRun(dir, "matter-1", run.runId);
    expect(done?.status).toBe("done");
    expect(done?.steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"]);
    expect(done?.steps[1]?.outputRefs).toEqual(["draft:task-1"]);
    expect(done?.steps[3]?.outputRefs).toEqual(["inbox:item-1"]);
  });

  it("does not rerun completed steps after a restart", async () => {
    const dir = workspace();
    const run = createDeliveryRunOnDisk(dir, {
      matterId: "matter-1",
      jobId: "job-1",
      automationId: "auto-1",
    });
    let waitCalls = 0;
    await resumeMatterRuns(dir, {
      matterId: "matter-1",
      runId: run.runId,
      executors: executors({
        [DELIVERY_RUN_STEP_KINDS.waitJob]: async () => {
          waitCalls += 1;
          return {
            status: "done",
            cursor: { jobStatus: "completed" },
            outputRefs: ["job:job-1"],
          };
        },
      }),
      at: "2026-10-28T00:00:00.000Z",
    });
    expect(waitCalls).toBe(1);

    await resumeMatterRuns(dir, {
      matterId: "matter-1",
      runId: run.runId,
      executors: executors({
        [DELIVERY_RUN_STEP_KINDS.waitJob]: async () => {
          waitCalls += 1;
          return { status: "done" };
        },
      }),
      at: "2026-10-28T00:00:02.000Z",
    });
    expect(waitCalls).toBe(1);
  });

  it("keeps a corrupted run from blocking other runs", () => {
    const dir = workspace();
    const run = createDeliveryRunOnDisk(dir, {
      matterId: "matter-1",
      jobId: "job-1",
    });
    expect(loadMatterRun(dir, "matter-1", run.runId)?.runId).toBe(run.runId);
    expect(
      loadMatterRun(dir, "matter-1", "run_missing", { tolerateCorrupt: true }),
    ).toBeUndefined();
  });

  it("creates delivery runs for every template job unless explicitly disabled", () => {
    expect(shouldCreateDeliveryRun("mail-contract-redline", "1")).toBe(true);
    expect(shouldCreateDeliveryRun("client-update-memo", "1")).toBe(true);
    expect(shouldCreateDeliveryRun("renewal-monitor", "1")).toBe(true);
    expect(shouldCreateDeliveryRun(undefined, "1")).toBe(false);
    expect(shouldCreateDeliveryRun("  ", "1")).toBe(false);
    expect(shouldCreateDeliveryRun("mail-contract-redline", "0")).toBe(false);
  });
});
