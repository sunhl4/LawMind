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
import { DEFAULT_ASSISTANT_ID } from "../../assistants/constants.js";
import { loadAssistantProfiles, resolveLawMindRoot } from "../../assistants/store.js";
import { getRoleById } from "../../core/role.js";
import { emitCollaborationEvent } from "../collaboration/audit.js";
import {
  registerDelegation,
  markDelegationRunning,
  markDelegationCompleted,
  markDelegationFailed,
} from "../collaboration/delegation-registry.js";
import { sendAndWait, wrapUntrustedResult } from "../collaboration/message-bus.js";
import {
  appendMemoryBundleToTask,
  type WorkflowMemoryBundleSnapshot,
} from "../collaboration/workflow-memory-bundle.js";
import { findAssistantsByRole, resolveAssistantId } from "../tools/coordination/utils.js";
import type { AgentConfig } from "../types.js";
import type { CollaborationWorkflow, WorkflowStep, WorkflowEvent } from "./types.js";

/**
 * W8：在派发前根据 step.assigneeRoleId 重新解析 assignee。
 * 必须传入与桌面端一致的 `envFile`，否则会误读 workspace 旁路的空 assistants.json，
 * 导致 mail-contract 等模板卡在 `Assistant not found: contract_review`。
 */
export function resolveStepAssigneeByRole(
  workspaceDir: string,
  step: WorkflowStep,
  envFile?: string,
): void {
  const roleId = step.assigneeRoleId?.trim();
  if (roleId) {
    const role = getRoleById(roleId);
    if (role) {
      const candidates = findAssistantsByRole(workspaceDir, role.roleId, envFile);
      if (candidates.length > 0) {
        if (!step.assignee || !candidates.some((c) => c.assistantId === step.assignee)) {
          step.assignee = candidates[0].assistantId;
        }
        return;
      }
    }
  }

  // Role miss / literal role id as assignee ("contract_review"): map to real assistant id.
  const raw = step.assignee?.trim() || roleId || "";
  if (!raw) {
    step.assignee = DEFAULT_ASSISTANT_ID;
    return;
  }
  const resolved = resolveAssistantId(workspaceDir, raw, envFile);
  if (resolved) {
    step.assignee = resolved;
    return;
  }
  // Last resort: first profile in LawMind root, else default.
  const root = resolveLawMindRoot(workspaceDir, envFile);
  const profiles = loadAssistantProfiles(root);
  step.assignee = profiles[0]?.assistantId ?? DEFAULT_ASSISTANT_ID;
}

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
 * 模板级预批准白名单：只允许「待拍板」类工具（产出仍须律师在在办拍板，
 * 无外部副作用）。send_email / render_document 等交付/外发工具永远不在此列。
 */
const TEMPLATE_PREAPPROVABLE_TOOLS = new Set([
  "apply_surgical_edits",
  "render_tracked_draft",
  "prepare_outbound_mail",
]);

export function templatePreApprovableTools(names: string[] | undefined): string[] | undefined {
  const filtered = (names ?? []).filter((n) => TEMPLATE_PREAPPROVABLE_TOOLS.has(n));
  return filtered.length > 0 ? filtered : undefined;
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
  resolveStepAssigneeByRole(baseConfig.workspaceDir, step, baseConfig.envFile);
  step.status = "running";
  step.startedAt = new Date().toISOString();

  emitWorkflowEvent(baseConfig.workspaceDir, workflow, "workflow.step_started", step.stepId);
  emitProgress(workflow, options);

  const contextFromDeps = gatherDependencyContext(workflow, step);
  const taskWithMemory = appendMemoryBundleToTask(step.task, options?.memoryBundle, step.assignee);
  const fullTask = `${taskWithMemory}${contextFromDeps}`;

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
      // Name list only; apply_surgical_edits / prepare_outbound_mail still need
      // matching preApproveToolArgs (hunks or to+attachments).
      preApproveToolNames: templatePreApprovableTools(workflow.preApproveToolNames),
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
  /** Enqueue-time assistant PROFILE excerpts for assignees (scheduled job distribution). */
  memoryBundle?: WorkflowMemoryBundleSnapshot;
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
