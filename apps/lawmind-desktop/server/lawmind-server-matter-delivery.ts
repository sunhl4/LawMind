/**
 * delivery run 的桌面执行器：等 job、收集草稿、补渲染、准备待发信。
 *
 * 这个文件住在桌面 server，因为 job 账本和自动办件收件箱都在这一侧；
 * 引擎只提供 MatterRun 状态机与渲染入口。外发步骤只写待发信/待拍板，
 * 不调用 `send_email`，也不替律师点「签批发送」。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { listDrafts, readDraft } from "../../../src/lawmind/drafts/index.js";
import {
  DELIVERY_RUN_STEP_KINDS,
  deliveryRunRefs,
} from "../../../src/lawmind/platform/matter-delivery-run.js";
import type {
  MatterRun,
  MatterRunStep,
  MatterRunStepExecutor,
} from "../../../src/lawmind/platform/matter-run-store.js";
import type { ArtifactDraft } from "../../../src/lawmind/types.js";
import {
  extractNotifyEmail,
  getAutomation,
  listOpenAutomationInbox,
  sanitizeNotifyEmail,
  saveAutomationInboxItem,
  type AutomationInboxItem,
} from "../../../src/lawmind/platform/lawyer-automations.js";
import { getLawMindEngine } from "./lawmind-server-helpers.js";
import { getWorkflowJob, isTerminalWorkflowJobStatus } from "./lawmind-server-jobs.js";

const WAIT_HOURS = 24;

function plusHours(at: string, hours: number): string {
  const ms = Date.parse(at);
  return new Date((Number.isFinite(ms) ? ms : Date.now()) + hours * 3_600_000).toISOString();
}

function cursorOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function stepCursor(run: MatterRun, stepId: string): Record<string, unknown> {
  const step = run.steps.find((item) => item.stepId === stepId);
  return cursorOf(step?.cursor);
}

function draftTaskIdsFromRun(run: MatterRun): string[] {
  return stringArray(stepCursor(run, "collect").draftTaskIds);
}

function fileExists(workspaceDir: string, relativePath: string | undefined): boolean {
  if (!relativePath?.trim()) {
    return false;
  }
  try {
    return fs.existsSync(path.resolve(workspaceDir, relativePath));
  } catch {
    return false;
  }
}

function fileMtimeMs(workspaceDir: string, relativePath: string | undefined): number | undefined {
  if (!relativePath?.trim()) {
    return undefined;
  }
  try {
    return fs.statSync(path.resolve(workspaceDir, relativePath)).mtimeMs;
  } catch {
    return undefined;
  }
}

function jobStartedMs(startedAt: string | undefined, createdAt: string): number {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  return Number.isFinite(start) ? start : Date.parse(createdAt) || 0;
}

function draftsFromJob(workspaceDir: string, job: {
  matterId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}, matterId: string): ArtifactDraft[] {
  const since = jobStartedMs(job.startedAt, job.createdAt);
  const until = job.completedAt ? Date.parse(job.completedAt) : Number.POSITIVE_INFINITY;
  const inWindow = (time: number | undefined): boolean =>
    time !== undefined && Number.isFinite(time) && time >= since && time <= until;
  return listDrafts(workspaceDir)
    .filter((draft) => draft.matterId === matterId)
    .filter((draft) => {
      const created = Date.parse(draft.createdAt);
      if (inWindow(created)) {
        return true;
      }
      return inWindow(fileMtimeMs(workspaceDir, draft.outputPath));
    })
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function preview(text: string | undefined, max = 240): string {
  const trimmed = text?.trim() ?? "";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

async function waitJob(ctx: Parameters<MatterRunStepExecutor>[0]) {
  const { jobId } = deliveryRunRefs(ctx.step);
  if (!jobId) {
    return { status: "failed" as const, error: "delivery_run_missing_job", retryable: false };
  }
  const job = getWorkflowJob(jobId);
  if (!job) {
    return { status: "failed" as const, error: "delivery_run_job_missing", retryable: false };
  }
  if (job.status === "failed") {
    return {
      status: "failed" as const,
      error: `job_failed:${job.error ?? ""}`.slice(0, 2_000),
      retryable: false,
    };
  }
  if (job.status === "cancelled") {
    return { status: "skipped" as const, reason: "job_cancelled" };
  }
  if (isTerminalWorkflowJobStatus(job.status)) {
    return {
      status: "done" as const,
      cursor: { jobStatus: job.status },
      outputRefs: [`job:${jobId}`],
    };
  }
  return {
    status: "waiting" as const,
    wait: {
      reason: job.status === "awaiting_lawyer" ? ("lawyer_decision" as const) : ("external_event" as const),
      eventKeys: [`job:${jobId}`],
      dueAt: plusHours(ctx.at, WAIT_HOURS),
    },
  };
}

async function collect(ctx: Parameters<MatterRunStepExecutor>[0]) {
  const { jobId } = deliveryRunRefs(ctx.step);
  if (!jobId) {
    return { status: "failed" as const, error: "delivery_run_missing_job", retryable: false };
  }
  const job = getWorkflowJob(jobId);
  if (!job) {
    return { status: "failed" as const, error: "delivery_run_job_missing", retryable: false };
  }
  if (job.status !== "completed") {
    return { status: "skipped" as const, reason: `job_${job.status}` };
  }
  const matterId = job.matterId ?? ctx.run.matterId;
  const drafts = draftsFromJob(ctx.workspaceDir, job, matterId);
  if (drafts.length === 0) {
    return { status: "skipped" as const, reason: "no_drafts_from_job" };
  }
  const primary = drafts.find((draft) => fileExists(ctx.workspaceDir, draft.outputPath)) ?? drafts[0];
  return {
    status: "done" as const,
    cursor: {
      jobStatus: job.status,
      draftTaskIds: drafts.map((draft) => draft.taskId),
      primaryTaskId: primary.taskId,
    },
    outputRefs: drafts.map((draft) => `draft:${draft.taskId}`),
  };
}

async function render(ctx: Parameters<MatterRunStepExecutor>[0]) {
  const taskIds = draftTaskIdsFromRun(ctx.run);
  if (taskIds.length === 0) {
    return { status: "skipped" as const, reason: "no_drafts_from_job" };
  }
  const engine = getLawMindEngine(ctx.workspaceDir);
  const rendered: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const taskId of taskIds) {
    const draft = readDraft(ctx.workspaceDir, taskId);
    if (!draft) {
      skipped.push(`${taskId}:missing`);
      continue;
    }
    if (fileExists(ctx.workspaceDir, draft.outputPath)) {
      skipped.push(`${taskId}:already_rendered`);
      continue;
    }
    if (draft.reviewStatus !== "approved") {
      skipped.push(`${taskId}:awaiting_review`);
      continue;
    }
    const result = await engine.render(draft);
    if (result.ok && result.outputPath) {
      rendered.push(taskId);
    } else {
      errors.push(`${taskId}:${result.error ?? "render_failed"}`);
    }
  }
  if (errors.length > 0) {
    return {
      status: "failed" as const,
      error: errors.join("; ").slice(0, 2_000),
      retryable: false,
    };
  }
  return {
    status: "done" as const,
    cursor: { rendered, skipped },
    outputRefs: rendered.map((taskId) => `rendered:${taskId}`),
  };
}

function pendingSendForAutomation(
  workspaceDir: string,
  automation: ReturnType<typeof getAutomation>,
  draft: ArtifactDraft | undefined,
): AutomationInboxItem["pendingSend"] | undefined {
  if (!automation?.allowSendEmailAfterApproval || automation.presetId !== "client-weekly-update") {
    return undefined;
  }
  const to = sanitizeNotifyEmail(automation.notifyEmail) || extractNotifyEmail(automation.instruction);
  if (!to) {
    return undefined;
  }
  return {
    to,
    subject: `【${automation.matterId}】本案进展说明`,
    body: `后台工作流已完成。请在「待发信」核对正文与附件后再签批发送。\n\n${preview(draft?.summary, 500)}`,
    ...(draft?.outputPath ? { attachmentRelativePaths: [draft.outputPath] } : {}),
  };
}

async function prepareOutbound(ctx: Parameters<MatterRunStepExecutor>[0]) {
  const { jobId, automationId } = deliveryRunRefs(ctx.step);
  if (!jobId || !automationId) {
    return { status: "skipped" as const, reason: "delivery_run_missing_automation" };
  }
  const job = getWorkflowJob(jobId);
  if (!job || job.status !== "completed") {
    return { status: "skipped" as const, reason: `job_${job?.status ?? "missing"}` };
  }
  const automation = getAutomation(ctx.workspaceDir, automationId);
  if (!automation) {
    return { status: "skipped" as const, reason: "automation_missing" };
  }
  const primaryTaskId = stepCursor(ctx.run, "collect").primaryTaskId;
  const draft =
    typeof primaryTaskId === "string" && primaryTaskId.trim()
      ? readDraft(ctx.workspaceDir, primaryTaskId.trim())
      : undefined;
  if (!draft) {
    return { status: "skipped" as const, reason: "no_draft_from_job" };
  }
  const rendered = fileExists(ctx.workspaceDir, draft.outputPath);
  const summary = `后台工作流已完成。草稿「${draft.title}」${rendered ? "已导出，可在文书台核对" : "还没导出（需审核通过后导出）"}；外发仍要你签批。`;
  const pendingSend = pendingSendForAutomation(ctx.workspaceDir, automation, draft);
  const existing = listOpenAutomationInbox(ctx.workspaceDir, ctx.run.matterId).find(
    (item) => item.jobId === jobId && item.automationId === automationId,
  );

  if (existing) {
    existing.title = `${automation.title} · 交付物已就绪`;
    existing.summary = summary;
    if (draft?.taskId) {
      existing.draftTaskId = draft.taskId;
    }
    if (!existing.pendingSend && pendingSend) {
      existing.pendingSend = pendingSend;
    }
    saveAutomationInboxItem(ctx.workspaceDir, existing);
    return { status: "done" as const, outputRefs: [`inbox:${existing.id}`] };
  }

  const item: AutomationInboxItem = {
    id: randomUUID(),
    automationId,
    matterId: ctx.run.matterId,
    title: `${automation.title} · 交付物已就绪`,
    summary,
    status: "open",
    createdAt: ctx.at,
    jobId,
    ...(draft?.taskId ? { draftTaskId: draft.taskId } : {}),
    ...(pendingSend ? { pendingSend } : {}),
  };
  saveAutomationInboxItem(ctx.workspaceDir, item);
  return { status: "done" as const, outputRefs: [`inbox:${item.id}`] };
}

/** 注册给 `tickMatterRuns` 的四类步骤执行器。 */
export function createDeliveryRunExecutors(): Record<string, MatterRunStepExecutor> {
  return {
    [DELIVERY_RUN_STEP_KINDS.waitJob]: waitJob,
    [DELIVERY_RUN_STEP_KINDS.collect]: collect,
    [DELIVERY_RUN_STEP_KINDS.render]: render,
    [DELIVERY_RUN_STEP_KINDS.outboundPrepare]: prepareOutbound,
  };
}

/** 测试/诊断：把 run 的步骤压成律师可读的一行。 */
export function describeDeliveryStep(step: MatterRunStep): string {
  const title = step.title?.trim() || step.stepId;
  return `${title}（${step.status}，第 ${step.attempts} 次）`;
}
