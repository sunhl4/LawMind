/**
 * delivery run 的桌面执行器：等 job、收集草稿、补渲染、准备待发信。
 * job 账本与渲染入口在本测试里用 mock 固定；自动办件收件箱与草稿走真实文件。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowJobRecord } from "./lawmind-server-jobs.js";
import { createDeliveryRunExecutors } from "./lawmind-server-matter-delivery.js";
import {
  createDeliveryRunOnDisk,
  DELIVERY_RUN_STEP_KINDS,
} from "../../../src/lawmind/platform/matter-delivery-run.js";
import {
  loadMatterRun,
  resumeMatterRuns,
} from "../../../src/lawmind/platform/matter-run-store.js";
import { getWorkflowJob } from "./lawmind-server-jobs.js";
import { getLawMindEngine } from "./lawmind-server-helpers.js";
import { persistDraft } from "../../../src/lawmind/drafts/index.js";
import {
  listOpenAutomationInbox,
  saveAutomation,
  type LawyerAutomation,
} from "../../../src/lawmind/platform/lawyer-automations.js";
import type { ArtifactDraft } from "../../../src/lawmind/types.js";

vi.mock("./lawmind-server-jobs.js", () => ({
  getWorkflowJob: vi.fn(),
  isTerminalWorkflowJobStatus: (status: string) =>
    status === "completed" || status === "failed" || status === "cancelled",
}));

vi.mock("./lawmind-server-helpers.js", () => ({
  getLawMindEngine: vi.fn(),
}));

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-delivery-exec-"));
  dirs.push(dir);
  return dir;
}

function automation(patch: Partial<LawyerAutomation> = {}): LawyerAutomation {
  return {
    id: "auto-1",
    title: "邮件合同审阅",
    enabled: true,
    presetId: "mail-contract-review",
    matterId: "matter-1",
    schedule: { kind: "once", runAt: "2026-10-28T00:00:00.000Z" },
    nextRunAt: "2026-10-28T00:00:00.000Z",
    allowSendEmailAfterApproval: false,
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
    ...patch,
  };
}

function draft(ws: string, patch: Partial<ArtifactDraft> = {}): ArtifactDraft {
  const value: ArtifactDraft = {
    taskId: "task-1",
    matterId: "matter-1",
    title: "审阅稿",
    output: "docx",
    templateId: "builtin",
    summary: "已按剧本审阅",
    sections: [],
    reviewNotes: [],
    reviewStatus: "approved",
    createdAt: "2026-10-28T00:10:00.000Z",
    ...patch,
  };
  persistDraft(ws, value);
  return value;
}

function job(ws: string, patch: Partial<WorkflowJobRecord> = {}): WorkflowJobRecord {
  return {
    jobId: "job-1",
    kind: "workflow_run",
    status: "completed",
    workflowId: "wf-1",
    matterId: "matter-1",
    workspaceDir: ws,
    createdAt: "2026-10-28T00:00:00.000Z",
    startedAt: "2026-10-28T00:00:01.000Z",
    completedAt: "2026-10-28T00:20:00.000Z",
    ...patch,
  } as WorkflowJobRecord;
}

function renderedDraft(ws: string, patch: Partial<ArtifactDraft> = {}): ArtifactDraft {
  const value = draft(ws, { outputPath: "artifacts/task-1.docx", ...patch });
  fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(ws, "artifacts", "task-1.docx"), "rendered", "utf8");
  return value;
}

async function runDelivery(ws: string) {
  const run = createDeliveryRunOnDisk(ws, {
    matterId: "matter-1",
    jobId: "job-1",
    automationId: "auto-1",
  });
  await resumeMatterRuns(ws, {
    matterId: "matter-1",
    runId: run.runId,
    executors: createDeliveryRunExecutors(),
    at: "2026-10-28T00:21:00.000Z",
  });
  return loadMatterRun(ws, "matter-1", run.runId);
}

describe("delivery run executors", () => {
  it("waits while the job runs and finishes after it completes", async () => {
    const ws = workspace();
    saveAutomation(ws, automation());
    renderedDraft(ws);
    vi.mocked(getWorkflowJob).mockReturnValueOnce(job(ws, { status: "running" }));
    const waiting = await runDelivery(ws);
    expect(waiting?.status).toBe("waiting");
    expect(waiting?.steps[0]?.wait?.eventKeys).toEqual(["job:job-1"]);

    vi.mocked(getWorkflowJob).mockReturnValue(job(ws));
    const run = createDeliveryRunOnDisk(ws, {
      matterId: "matter-1",
      jobId: "job-1",
      automationId: "auto-1",
    });
    const { wakeMatterRunsForEvent } = await import(
      "../../../src/lawmind/platform/matter-run-store.js"
    );
    wakeMatterRunsForEvent(ws, "job:job-1", { at: "2026-10-28T00:21:01.000Z" });
    await resumeMatterRuns(ws, {
      matterId: "matter-1",
      runId: run.runId,
      executors: createDeliveryRunExecutors(),
      at: "2026-10-28T00:21:02.000Z",
    });
    const done = loadMatterRun(ws, "matter-1", run.runId);
    expect(done?.status).toBe("done");
    expect(done?.steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"]);
  });

  it("collects the draft from the job window and exposes it in the inbox", async () => {
    const ws = workspace();
    saveAutomation(ws, automation());
    renderedDraft(ws);
    vi.mocked(getWorkflowJob).mockReturnValue(job(ws));

    const run = await runDelivery(ws);
    expect(run?.status).toBe("done");
    const collect = run?.steps.find((step) => step.stepId === "collect");
    expect(collect?.cursor).toMatchObject({
      draftTaskIds: ["task-1"],
      primaryTaskId: "task-1",
    });
    const inbox = listOpenAutomationInbox(ws, "matter-1");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      automationId: "auto-1",
      jobId: "job-1",
      draftTaskId: "task-1",
      title: "邮件合同审阅 · 交付物已就绪",
    });
  });

  it("renders an approved draft without an output file, once", async () => {
    const ws = workspace();
    saveAutomation(ws, automation());
    draft(ws, { outputPath: undefined });
    vi.mocked(getWorkflowJob).mockReturnValue(job(ws));
    const render = vi.fn(async () => {
      fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
      fs.writeFileSync(path.join(ws, "artifacts", "task-1.docx"), "rendered", "utf8");
      return { ok: true, outputPath: "artifacts/task-1.docx" };
    });
    vi.mocked(getLawMindEngine).mockReturnValue({ render } as never);

    const run = await runDelivery(ws);
    expect(run?.status).toBe("done");
    expect(render).toHaveBeenCalledTimes(1);
    const renderStep = run?.steps.find((step) => step.stepId === "render");
    expect(renderStep?.cursor).toMatchObject({ rendered: ["task-1"] });
  });

  it("does not render a draft that is still pending review", async () => {
    const ws = workspace();
    saveAutomation(ws, automation());
    draft(ws, { reviewStatus: "pending" });
    vi.mocked(getWorkflowJob).mockReturnValue(job(ws));
    const render = vi.fn();
    vi.mocked(getLawMindEngine).mockReturnValue({ render } as never);

    const run = await runDelivery(ws);
    expect(run?.status).toBe("done");
    expect(render).not.toHaveBeenCalled();
    const renderStep = run?.steps.find((step) => step.stepId === "render");
    expect(renderStep?.cursor).toMatchObject({ skipped: ["task-1:awaiting_review"] });
  });

  it("adds a pending send only for an approved weekly update with a real recipient", async () => {
    const ws = workspace();
    saveAutomation(
      ws,
      automation({
        presetId: "client-weekly-update",
        allowSendEmailAfterApproval: true,
        notifyEmail: "client@example.org",
      }),
    );
    draft(ws, { outputPath: "artifacts/task-1.docx" });
    fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "artifacts", "task-1.docx"), "rendered", "utf8");
    vi.mocked(getWorkflowJob).mockReturnValue(job(ws));

    await runDelivery(ws);
    const inbox = listOpenAutomationInbox(ws, "matter-1");
    expect(inbox[0]?.pendingSend).toMatchObject({
      to: "client@example.org",
      attachmentRelativePaths: ["artifacts/task-1.docx"],
      binding: {
        packet: {
          packetId: "pkt_automation_task-1",
        },
      },
    });
    expect(inbox[0]?.pendingSend?.binding?.packet?.packetHash).toMatch(/^[a-f0-9]{32}$/);
  });

  it("fails the run when the job failed, without writing a ready item", async () => {
    const ws = workspace();
    saveAutomation(ws, automation());
    draft(ws);
    vi.mocked(getWorkflowJob).mockReturnValue(job(ws, { status: "failed", error: "boom" }));

    const run = await runDelivery(ws);
    expect(run?.status).toBe("failed");
    expect(run?.steps[0]?.error).toContain("job_failed");
    expect(listOpenAutomationInbox(ws, "matter-1")).toEqual([]);
  });

  it("skips when the job completed without any draft", async () => {
    const ws = workspace();
    saveAutomation(ws, automation());
    vi.mocked(getWorkflowJob).mockReturnValue(job(ws));

    const run = await runDelivery(ws);
    expect(run?.status).toBe("done");
    const collect = run?.steps.find((step) => step.stepId === "collect");
    expect(collect?.status).toBe("skipped");
    expect(collect?.error).toBeUndefined();
    const outbound = run?.steps.find((step) => step.stepId === "outbound");
    expect(outbound?.status).toBe("skipped");
    expect(listOpenAutomationInbox(ws, "matter-1")).toEqual([]);
  });

  it("exposes the step kinds used by the executors", () => {
    const executors = createDeliveryRunExecutors();
    expect(Object.keys(executors).toSorted()).toEqual(
      [
        DELIVERY_RUN_STEP_KINDS.waitJob,
        DELIVERY_RUN_STEP_KINDS.collect,
        DELIVERY_RUN_STEP_KINDS.render,
        DELIVERY_RUN_STEP_KINDS.outboundPrepare,
      ].toSorted(),
    );
  });
});
