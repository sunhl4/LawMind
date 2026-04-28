/**
 * Workflow executor — runs multi-assistant workflows respecting dependency graphs.
 *
 * The executor:
 *   1. Topologically sorts steps by their dependencies
 *   2. Dispatches ready steps in parallel via the collaboration message bus
 *   3. Waits for each step to complete before dispatching dependents
 *   4. Optionally sends step output through a review assistant
 *   5. Aggregates results and reports to the lawyer
 */

import { randomUUID } from "node:crypto";
import { emitCollaborationEvent } from "../collaboration/audit.js";
import {
  registerDelegation,
  markDelegationRunning,
  markDelegationCompleted,
  markDelegationFailed,
} from "../collaboration/delegation-registry.js";
import { sendAndWait, wrapUntrustedResult } from "../collaboration/message-bus.js";
import type { AgentConfig } from "../types.js";
import type { CollaborationWorkflow, WorkflowStep, WorkflowEvent } from "./types.js";

function emitWorkflowEvent(
  workspaceDir: string,
  workflow: CollaborationWorkflow,
  kind: WorkflowEvent["kind"],
  stepId?: string,
  detail?: string,
): void {
  emitCollaborationEvent(workspaceDir, {
    eventId: randomUUID(),
    kind:
      kind === "workflow.cancelled"
        ? "delegation.cancelled"
        : kind === "workflow.step_started"
          ? "delegation.started"
          : kind === "workflow.step_completed"
            ? "delegation.completed"
            : kind === "workflow.step_failed"
              ? "delegation.failed"
              : "delegation.created",
    fromAssistantId: workflow.createdBy,
    toAssistantId: stepId ? (workflow.steps.find((s) => s.stepId === stepId)?.assignee ?? "") : "",
    matterId: workflow.matterId,
    detail: `workflow=${workflow.workflowId} ${kind}${stepId ? ` step=${stepId}` : ""}${detail ? ` ${detail}` : ""}`,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Find all steps that are ready to run (all dependencies completed).
 */
function findReadySteps(workflow: CollaborationWorkflow): WorkflowStep[] {
  return workflow.steps.filter((step) => {
    if (step.status !== "pending") {
      return false;
    }
    return step.dependsOn.every((depId) => {
      const dep = workflow.steps.find((s) => s.stepId === depId);
      return dep?.status === "completed";
    });
  });
}

/**
 * Gather results from completed dependency steps as context.
 */
function gatherDependencyContext(workflow: CollaborationWorkflow, step: WorkflowStep): string {
  if (step.dependsOn.length === 0) {
    return "";
  }

  const parts: string[] = [];
  for (const depId of step.dependsOn) {
    const dep = workflow.steps.find((s) => s.stepId === depId);
    if (dep?.result) {
      parts.push(
        `--- 来自「${dep.assignee}」的结果 (步骤: ${dep.task.slice(0, 60)}) ---\n${dep.result}`,
      );
    }
  }

  if (parts.length === 0) {
    return "";
  }
  return `\n\n以下是前序步骤的产出，供你参考：\n\n${parts.join("\n\n")}`;
}

/**
 * Execute a single workflow step: delegate to assignee, optionally review.
 */
async function executeStep(
  baseConfig: AgentConfig,
  workflow: CollaborationWorkflow,
  step: WorkflowStep,
  options?: ExecuteWorkflowOptions,
): Promise<void> {
  step.status = "running";
  step.startedAt = new Date().toISOString();

  emitWorkflowEvent(baseConfig.workspaceDir, workflow, "workflow.step_started", step.stepId);
  emitProgress(workflow, options);

  const contextFromDeps = gatherDependencyContext(workflow, step);
  const fullTask = `${step.task}${contextFromDeps}`;

  const delegation = registerDelegation({
    workspaceDir: baseConfig.workspaceDir,
    fromAssistantId: workflow.createdBy,
    toAssistantId: step.assignee,
    task: fullTask,
    matterId: workflow.matterId,
  });
  step.delegationId = delegation.delegationId;

  try {
    const result = await sendAndWait({
      baseConfig,
      fromAssistantId: workflow.createdBy,
      toAssistantId: step.assignee,
      message: fullTask,
      matterId: workflow.matterId,
      timeoutMs: 300_000,
    });

    markDelegationRunning(baseConfig.workspaceDir, delegation.delegationId, result.sessionId);

    let finalResult = result.reply;

    if (step.reviewBy && !step.autoApprove) {
      try {
        const review = await sendAndWait({
          baseConfig,
          fromAssistantId: step.assignee,
          toAssistantId: step.reviewBy,
          message: `请审查以下来自「${step.assignee}」的工作成果：\n\n${result.reply}`,
          matterId: workflow.matterId,
          timeoutMs: 120_000,
        });
        finalResult = `${result.reply}\n\n--- 审查意见 (${step.reviewBy}) ---\n${review.reply}`;
      } catch {
        finalResult = `${result.reply}\n\n[审查助手未响应，结果未经审查]`;
      }
    }

    step.result = finalResult;
    step.status = "completed";
    step.completedAt = new Date().toISOString();
    markDelegationCompleted(baseConfig.workspaceDir, delegation.delegationId, finalResult);
    emitWorkflowEvent(baseConfig.workspaceDir, workflow, "workflow.step_completed", step.stepId);
    emitProgress(workflow, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    step.error = msg;
    step.status = "failed";
    step.completedAt = new Date().toISOString();
    markDelegationFailed(baseConfig.workspaceDir, delegation.delegationId, msg);
    emitWorkflowEvent(baseConfig.workspaceDir, workflow, "workflow.step_failed", step.stepId, msg);
    emitProgress(workflow, options);
  }
}

/** Step counts for UIs / job records (reference-stack-style run observability). */
export type WorkflowRunProgress = {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  runningStepIds: string[];
};

function computeWorkflowRunProgress(workflow: CollaborationWorkflow): WorkflowRunProgress {
  const steps = workflow.steps;
  return {
    totalSteps: steps.length,
    completedSteps: steps.filter((s) => s.status === "completed" || s.status === "skipped").length,
    failedSteps: steps.filter((s) => s.status === "failed").length,
    runningStepIds: steps.filter((s) => s.status === "running").map((s) => s.stepId),
  };
}

/** Checked between step batches and while idle waiting; does not abort in-flight `sendAndWait`. */
export type ExecuteWorkflowOptions = {
  shouldAbort?: () => boolean;
  /** Called when step statuses change (start/end of steps, and once at workflow start). */
  onProgress?: (snapshot: WorkflowRunProgress) => void;
};

function abortRequested(options?: ExecuteWorkflowOptions): boolean {
  return options?.shouldAbort?.() === true;
}

function emitProgress(workflow: CollaborationWorkflow, options?: ExecuteWorkflowOptions): void {
  options?.onProgress?.(computeWorkflowRunProgress(workflow));
}

/**
 * Execute a complete workflow, dispatching steps in dependency order.
 *
 * Steps with no unfinished dependencies run in parallel.
 * The executor loops until all steps are done or the workflow is stuck.
 */
export async function executeWorkflow(
  baseConfig: AgentConfig,
  workflow: CollaborationWorkflow,
  options?: ExecuteWorkflowOptions,
): Promise<CollaborationWorkflow> {
  workflow.status = "running";
  workflow.updatedAt = new Date().toISOString();
  emitWorkflowEvent(baseConfig.workspaceDir, workflow, "workflow.started");
  emitProgress(workflow, options);

  let maxIterations = workflow.steps.length * 2;

  while (maxIterations-- > 0) {
    if (abortRequested(options)) {
      workflow.status = "cancelled";
      emitWorkflowEvent(
        baseConfig.workspaceDir,
        workflow,
        "workflow.cancelled",
        undefined,
        "aborted",
      );
      break;
    }

    const readySteps = findReadySteps(workflow);

    if (readySteps.length === 0) {
      if (abortRequested(options)) {
        workflow.status = "cancelled";
        emitWorkflowEvent(
          baseConfig.workspaceDir,
          workflow,
          "workflow.cancelled",
          undefined,
          "aborted",
        );
        break;
      }
      const hasRunning = workflow.steps.some((s) => s.status === "running");
      if (hasRunning) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      break;
    }

    await Promise.all(readySteps.map((step) => executeStep(baseConfig, workflow, step, options)));

    if (abortRequested(options)) {
      workflow.status = "cancelled";
      emitWorkflowEvent(
        baseConfig.workspaceDir,
        workflow,
        "workflow.cancelled",
        undefined,
        "aborted",
      );
      break;
    }
  }

  workflow.completedAt = new Date().toISOString();
  workflow.updatedAt = new Date().toISOString();

  if (workflow.status === "cancelled") {
    return workflow;
  }

  const allCompleted = workflow.steps.every(
    (s) => s.status === "completed" || s.status === "skipped",
  );
  const anyFailed = workflow.steps.some((s) => s.status === "failed");

  if (allCompleted) {
    workflow.status = "completed";
    emitWorkflowEvent(baseConfig.workspaceDir, workflow, "workflow.completed");
  } else if (anyFailed) {
    workflow.status = "failed";
    emitWorkflowEvent(baseConfig.workspaceDir, workflow, "workflow.failed");
  }

  return workflow;
}

/**
 * Build a workflow summary report suitable for showing to the lawyer.
 */
export function buildWorkflowReport(workflow: CollaborationWorkflow): string {
  const lines: string[] = [];

  lines.push(`# 协作工作流报告：${workflow.name}`);
  lines.push(`状态：${workflow.status}`);
  lines.push(`案件：${workflow.matterId ?? "（无关联案件）"}`);
  lines.push("");

  for (const step of workflow.steps) {
    const statusEmoji = step.status === "completed" ? "✅" : step.status === "failed" ? "❌" : "⏳";
    lines.push(`## ${statusEmoji} 步骤：${step.task.slice(0, 80)}`);
    lines.push(`- 执行者：${step.assignee}`);
    lines.push(`- 状态：${step.status}`);
    if (step.reviewBy) {
      lines.push(`- 审查者：${step.reviewBy}`);
    }
    if (step.result) {
      lines.push(`- 结果：\n${wrapUntrustedResult(step.result.slice(0, 2000))}`);
    }
    if (step.error) {
      lines.push(`- 错误：${step.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
