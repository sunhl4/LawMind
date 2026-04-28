import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CollaborationWorkflow } from "../../../src/lawmind/agent/orchestrator/types.js";
import type { AgentConfig } from "../../../src/lawmind/agent/types.js";
import {
  clearWorkflowJobsForTests,
  enqueueWorkflowRun,
  getWorkflowJob,
  isSafeWorkflowJobId,
  listWorkflowJobs,
  loadJobsFromDiskOnStartup,
  requestCancelWorkflowJob,
  subscribeWorkflowJobUpdates,
} from "./lawmind-server-jobs.js";

function minimalWorkflow(overrides: Partial<CollaborationWorkflow> = {}): CollaborationWorkflow {
  const now = new Date().toISOString();
  return {
    workflowId: "wf-test",
    name: "Test",
    description: "d",
    steps: [
      {
        stepId: "s1",
        assignee: "asst-1",
        task: "do",
        dependsOn: [],
        autoApprove: true,
        status: "completed",
      },
    ],
    status: "completed",
    createdBy: "u",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-jobs-"));
}

function stubConfig(workspaceDir: string): AgentConfig {
  return {
    workspaceDir,
    model: {
      provider: "openai-compatible",
      baseUrl: "http://localhost",
      apiKey: "k",
      model: "m",
    },
  };
}

afterEach(() => {
  clearWorkflowJobsForTests();
});

describe("lawmind-server-jobs", () => {
  it("isSafeWorkflowJobId allows typical ids and rejects path injection", () => {
    expect(isSafeWorkflowJobId("stale-job-1")).toBe(true);
    expect(isSafeWorkflowJobId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isSafeWorkflowJobId("../etc/passwd")).toBe(false);
    expect(isSafeWorkflowJobId("a/b")).toBe(false);
    expect(isSafeWorkflowJobId("")).toBe(false);
  });

  it("enqueueWorkflowRun returns jobId and completes via injected runner", async () => {
    const ws = tmpWorkspace();
    const wf = minimalWorkflow();
    const jobId = enqueueWorkflowRun(stubConfig(ws), wf, {
      run: async () => wf,
    });
    expect(jobId.length).toBeGreaterThan(10);
    expect(getWorkflowJob(jobId)?.status).toBe("queued");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const done = getWorkflowJob(jobId);
    expect(done?.status).toBe("completed");
    expect(done?.workspaceDir).toBe(path.resolve(ws));
    expect(done?.result?.report).toContain("协作工作流报告");
    expect(done?.result?.workflowId).toBe("wf-test");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("marks job failed when runner throws", async () => {
    const ws = tmpWorkspace();
    const wf = minimalWorkflow();
    const jobId = enqueueWorkflowRun(stubConfig(ws), wf, {
      run: async () => {
        throw new Error("boom");
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const done = getWorkflowJob(jobId);
    expect(done?.status).toBe("failed");
    expect(done?.error).toBe("boom");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("marks job failed when workflow status is failed", async () => {
    const ws = tmpWorkspace();
    const wf = minimalWorkflow({
      status: "failed",
      steps: [
        {
          stepId: "s1",
          assignee: "a",
          task: "t",
          dependsOn: [],
          autoApprove: true,
          status: "failed",
          error: "step err",
        },
      ],
    });
    const jobId = enqueueWorkflowRun(stubConfig(ws), wf, {
      run: async () => wf,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const done = getWorkflowJob(jobId);
    expect(done?.status).toBe("failed");
    expect(done?.error).toBe("step err");
    expect(done?.result?.steps[0]?.error).toBe("step err");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("listWorkflowJobs returns recent jobs", async () => {
    const ws = tmpWorkspace();
    enqueueWorkflowRun(stubConfig(ws), minimalWorkflow({ workflowId: "a" }), {
      run: async (_c, w) => w,
    });
    enqueueWorkflowRun(stubConfig(ws), minimalWorkflow({ workflowId: "b" }), {
      run: async (_c, w) => w,
    });
    const listed = listWorkflowJobs(10);
    expect(listed.length).toBe(2);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("subscribeWorkflowJobUpdates receives snapshots as the job persists", async () => {
    const ws = tmpWorkspace();
    const wf = minimalWorkflow();
    const jobId = enqueueWorkflowRun(stubConfig(ws), wf, {
      run: async (_c, w) => w,
    });
    const statuses: string[] = [];
    const unsub = subscribeWorkflowJobUpdates(jobId, (j) => statuses.push(j.status));
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses.includes("completed")).toBe(true);
    unsub();
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("requestCancelWorkflowJob cancels queued job before run starts", async () => {
    const ws = tmpWorkspace();
    const wf = minimalWorkflow();
    const jobId = enqueueWorkflowRun(stubConfig(ws), wf, {
      run: async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return wf;
      },
    });
    const cancel = requestCancelWorkflowJob(jobId);
    expect(cancel.ok).toBe(true);
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));
    const done = getWorkflowJob(jobId);
    expect(done?.status).toBe("cancelled");
    expect(done?.error).toBe("cancelled_by_user");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("persists progress from onProgress and clears it when the job completes", async () => {
    const ws = tmpWorkspace();
    const wf = minimalWorkflow({ workflowId: "prog" });
    const jobId = enqueueWorkflowRun(stubConfig(ws), wf, {
      run: async (_c, w, opts) => {
        opts?.onProgress?.({
          totalSteps: 1,
          completedSteps: 0,
          failedSteps: 0,
          runningStepIds: ["s1"],
        });
        await new Promise<void>((r) => setTimeout(r, 120));
        return w;
      },
    });
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setTimeout(r, 30));
    const mid = getWorkflowJob(jobId);
    expect(mid?.status).toBe("running");
    expect(mid?.progress?.runningStepIds).toEqual(["s1"]);
    await new Promise<void>((r) => setTimeout(r, 150));
    const done = getWorkflowJob(jobId);
    expect(done?.status).toBe("completed");
    expect(done?.progress).toBeUndefined();
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("reuses jobId for same idempotencyKey while job non-terminal", () => {
    const ws = tmpWorkspace();
    const wf = minimalWorkflow({ workflowId: "idem" });
    const a = enqueueWorkflowRun(stubConfig(ws), wf, {
      idempotencyKey: "key-1",
      run: async () => wf,
    });
    const b = enqueueWorkflowRun(stubConfig(ws), wf, {
      idempotencyKey: "key-1",
      run: async () => wf,
    });
    expect(a).toBe(b);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("loadJobsFromDiskOnStartup marks queued jobs as failed", () => {
    const ws = tmpWorkspace();
    const jobId = "stale-job-1";
    const jdir = path.join(ws, "lawmind", "jobs");
    fs.mkdirSync(jdir, { recursive: true });
    fs.writeFileSync(
      path.join(jdir, `${jobId}.json`),
      JSON.stringify({
        jobId,
        kind: "workflow_run",
        status: "queued",
        workflowId: "w",
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );
    clearWorkflowJobsForTests();
    loadJobsFromDiskOnStartup(ws);
    const rec = getWorkflowJob(jobId);
    expect(rec?.status).toBe("failed");
    expect(rec?.error).toBe("interrupted_by_restart");
    fs.rmSync(ws, { recursive: true, force: true });
    clearWorkflowJobsForTests();
  });
});
