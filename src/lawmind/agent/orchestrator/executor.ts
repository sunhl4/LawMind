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
import { loadAssistantProfiles, resolveLawMindRoot } from "../../assistants/store.js";
import { getRoleById } from "../../core/role.js";
import { getMaxToolUseConcurrency } from "../../runtime/tool-concurrency.js";
import { emitCollaborationEvent } from "../collaboration/audit.js";
import {
  registerDelegation,
  markDelegationRunning,
  markDelegationAwaitingLawyer,
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
 * 单个协作步骤的等待上限。
 *
 * 原来是写死的 300s（实测会稳定打断「读合同 → 多轮改稿 → 独立审稿」这类真活：
 * 跑满 300s 后整步失败，律师在 Word/在办里只看到超时）。改为可调，默认给足 900s；
 * 仍可由 env 收紧或放宽（`LAWMIND_COLLAB_STEP_TIMEOUT_MS`）。
 */
export const DEFAULT_COLLAB_STEP_TIMEOUT_MS = 900_000;

export function resolveCollabStepTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LAWMIND_COLLAB_STEP_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_COLLAB_STEP_TIMEOUT_MS;
  }
  const n = Number(raw);
  // 太小的值会把正常任务打断；夹在 30s ~ 60min 之间，避免手滑。
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_COLLAB_STEP_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.floor(n), 30_000), 3_600_000);
}

const WORKFLOW_ASSIGNEE_ALIAS: Record<string, string> = {
  client_communicator: "client_memo",
  compliance_researcher: "compliance_research",
  litigation_drafter: "general_litigation",
  case_analyst: "due_diligence",
};

function requestedWorkflowRole(step: WorkflowStep): { roleId?: string; explicit: boolean } {
  const fromField = step.assigneeRoleId?.trim();
  if (fromField && getRoleById(fromField)) {
    return { roleId: fromField, explicit: true };
  }
  const assignee = step.assignee?.trim();
  if (assignee && getRoleById(assignee)) {
    return { roleId: assignee, explicit: true };
  }
  const alias = WORKFLOW_ASSIGNEE_ALIAS[fromField ?? ""] ?? WORKFLOW_ASSIGNEE_ALIAS[assignee ?? ""];
  if (alias && getRoleById(alias)) {
    return { roleId: alias, explicit: false };
  }
  return { explicit: false };
}

/**
 * W8：在派发前根据 step.assigneeRoleId 重新解析 assignee。
 * 必须传入与桌面端一致的 `envFile`，否则会误读 workspace 旁路的空 assistants.json，
 * 导致 mail-contract 等模板卡在 `Assistant not found: contract_review`。
 *
 * 模板里的旧称呼（client_communicator 等）对到六个真实岗位。对不上时，点名的真实岗位在多位助手里不能静默换人；旧称呼则交给通用助手并写明。
 */
export function resolveStepAssigneeByRole(
  workspaceDir: string,
  step: WorkflowStep,
  envFile?: string,
): void {
  const requested = requestedWorkflowRole(step);
  const role = requested.roleId ? getRoleById(requested.roleId) : undefined;
  if (role) {
    const candidates = findAssistantsByRole(workspaceDir, role.roleId, envFile);
    if (candidates.length > 0) {
      if (!step.assignee || !candidates.some((c) => c.assistantId === step.assignee)) {
        step.assignee = candidates[0].assistantId;
      }
      step.roleMissNote = undefined;
      return;
    }
  }

  const raw = step.assignee?.trim() || step.assigneeRoleId?.trim() || "";
  if (raw && !getRoleById(raw) && !WORKFLOW_ASSIGNEE_ALIAS[raw]) {
    const resolved = resolveAssistantId(workspaceDir, raw, envFile);
    if (resolved) {
      step.assignee = resolved;
      step.roleMissNote = undefined;
      return;
    }
  }

  const root = resolveLawMindRoot(workspaceDir, envFile);
  const profiles = loadAssistantProfiles(root);
  if (profiles.length === 0) {
    throw new Error("当前没有可用助手。");
  }
  const solo = profiles.length === 1;
  const fallback = solo
    ? profiles[0]
    : (profiles.find((p) => (p.roleId ?? p.presetKey) === "general_default") ?? profiles[0]);
  if (!fallback) {
    throw new Error("当前没有可用助手。");
  }
  if (!solo && requested.explicit) {
    throw new Error(
      `当前工作区没有承担「${role?.displayName ?? "该岗位"}」的助手。名册里有多位助手，不能改派给其中一位。请在设置里指定该岗位，或改由主办会话办理。`,
    );
  }
  step.assignee = fallback.assistantId;
  step.roleMissNote = role
    ? `没有承担「${role.displayName}」的助手。本步由「${fallback.displayName || fallback.assistantId}」办理。`
    : undefined;
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
 * 拓扑环检测：返回构成循环依赖的 stepId 路径（如 ["a","b","a"]），无环返回 null。
 * 缺失的依赖 id 不在此报错（该步骤会保持 pending，终态汇总为未完成）。
 */
export function findWorkflowDependencyCycle(steps: WorkflowStep[]): string[] | null {
  const byId = new Map(steps.map((s) => [s.stepId, s]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (stepId: string): string[] | null => {
    const mark = state.get(stepId);
    if (mark === "done") {
      return null;
    }
    if (mark === "visiting") {
      return [...stack.slice(stack.indexOf(stepId)), stepId];
    }
    const step = byId.get(stepId);
    if (!step) {
      return null;
    }
    state.set(stepId, "visiting");
    stack.push(stepId);
    for (const depId of step.dependsOn) {
      const cycle = visit(depId);
      if (cycle) {
        return cycle;
      }
    }
    stack.pop();
    state.set(stepId, "done");
    return null;
  };

  for (const step of steps) {
    const cycle = visit(step.stepId);
    if (cycle) {
      return cycle;
    }
  }
  return null;
}

/**
 * 依赖失败传播：依赖（含传递）失败/被跳过的 pending 步骤标记 skipped 并带原因，
 * 不再执行。迭代到不动点以覆盖传递链（A 失败 → B 跳过 → 依赖 B 的 C 也跳过）。
 */
function propagateDependencySkips(workflow: CollaborationWorkflow): boolean {
  let changed = false;
  let again = true;
  while (again) {
    again = false;
    for (const step of workflow.steps) {
      if (step.status !== "pending") {
        continue;
      }
      const blockers = step.dependsOn
        .map((depId) => workflow.steps.find((s) => s.stepId === depId))
        .filter(
          (dep): dep is WorkflowStep =>
            dep !== undefined && (dep.status === "failed" || dep.status === "skipped"),
        );
      if (blockers.length === 0) {
        continue;
      }
      step.status = "skipped";
      step.error = `依赖步骤未完成（${blockers.map((b) => b.stepId).join(", ")}），已跳过`;
      step.completedAt = new Date().toISOString();
      changed = true;
      again = true;
    }
  }
  return changed;
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

/** 互审步骤只读。显式 execution 优先；旧模板靠任务书开头的「互审」。 */
export function workflowStepExecution(step: WorkflowStep): "isolated" | "deliver" {
  if (step.execution === "isolated" || step.execution === "deliver") {
    return step.execution;
  }
  if (step.task.trim().startsWith("互审")) {
    return "isolated";
  }
  return "deliver";
}

/** 大纲确认步：模型直接交回正文也不算律师已经确认。 */
export function workflowStepHoldsForLawyer(step: WorkflowStep): boolean {
  if (step.holdForLawyer === true) {
    return true;
  }
  return step.task.includes("research_outline_confirm");
}

/** 律师确认后，把停住的步骤标成完成，以便后续步骤可以开始。 */
export function releaseWorkflowLawyerHold(
  workflow: CollaborationWorkflow,
  stepId?: string,
): boolean {
  let changed = false;
  for (const step of workflow.steps) {
    if (step.status !== "awaiting_lawyer") {
      continue;
    }
    if (stepId && step.stepId !== stepId) {
      continue;
    }
    step.status = "completed";
    step.completedAt = step.completedAt ?? new Date().toISOString();
    step.error = undefined;
    changed = true;
  }
  if (changed) {
    workflow.status = "running";
    workflow.updatedAt = new Date().toISOString();
  }
  return changed;
}

function workflowStatusLabel(status: string): string {
  switch (status) {
    case "awaiting_lawyer":
      return "待确认";
    case "completed":
      return "已完成";
    case "failed":
      return "未完成";
    case "cancelled":
      return "已取消";
    case "running":
      return "进行中";
    case "draft":
      return "未开始";
    default:
      return status;
  }
}

function stepStatusLabel(status: WorkflowStep["status"]): string {
  switch (status) {
    case "awaiting_lawyer":
      return "待确认";
    case "completed":
      return "已完成";
    case "failed":
      return "未完成";
    case "skipped":
      return "已跳过";
    case "running":
      return "进行中";
    case "pending":
      return "未开始";
    default:
      return status;
  }
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

  let delegationId: string | undefined;
  try {
    resolveStepAssigneeByRole(baseConfig.workspaceDir, step, baseConfig.envFile);
    const contextFromDeps = gatherDependencyContext(workflow, step);
    const taskWithMemory = appendMemoryBundleToTask(
      step.task,
      options?.memoryBundle,
      step.assignee,
    );
    const note = step.roleMissNote?.trim();
    const fullTask = `${note ? `${note}\n\n` : ""}${taskWithMemory}${contextFromDeps}`;

    const delegation = registerDelegation({
      workspaceDir: baseConfig.workspaceDir,
      fromAssistantId: workflow.createdBy,
      toAssistantId: step.assignee,
      task: fullTask,
      matterId: workflow.matterId,
    });
    delegationId = delegation.delegationId;
    step.delegationId = delegation.delegationId;

    const execution = workflowStepExecution(step);
    const deliverTools =
      execution === "deliver"
        ? templatePreApprovableTools(workflow.preApproveToolNames)
        : undefined;
    const result = await sendAndWait({
      baseConfig,
      fromAssistantId: workflow.createdBy,
      toAssistantId: step.assignee,
      message: fullTask,
      matterId: workflow.matterId,
      timeoutMs: resolveCollabStepTimeoutMs(),
      execution,
      preApproveToolNames: deliverTools,
      delegationId: delegation.delegationId,
      onSession: (sessionId) => {
        step.sessionId = sessionId;
        markDelegationRunning(baseConfig.workspaceDir, delegation.delegationId, sessionId);
      },
    });

    step.sessionId = result.sessionId || step.sessionId;
    if (!step.sessionId) {
      markDelegationRunning(baseConfig.workspaceDir, delegation.delegationId, result.sessionId);
    }

    const waitingOnLawyer =
      Boolean(result.hold) || (workflowStepHoldsForLawyer(step) && result.settledByLawyer !== true);
    if (waitingOnLawyer) {
      step.result = result.reply;
      step.status = "awaiting_lawyer";
      step.completedAt = new Date().toISOString();
      step.error = result.hold
        ? "这一步在等你确认。请在「在办」里回答；未确认前不会开始后续步骤。"
        : "大纲已写出。确认后才会写正文。";
      if (result.hold) {
        markDelegationAwaitingLawyer(
          baseConfig.workspaceDir,
          delegation.delegationId,
          "对方已停下，等你在「在办」里确认。确认前不会把这次交办当成已经办完。",
        );
      } else {
        markDelegationCompleted(baseConfig.workspaceDir, delegation.delegationId, result.reply);
      }
      emitProgress(workflow, options);
      return;
    }

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
          execution: "isolated",
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
    if (delegationId) {
      markDelegationFailed(baseConfig.workspaceDir, delegationId, msg);
    }
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
  // 加载/校验：循环依赖直接报错——否则步骤互相等待，workflow 静默停在 running。
  const cycle = findWorkflowDependencyCycle(workflow.steps);
  if (cycle) {
    throw new Error(`工作流存在循环依赖：${cycle.join(" → ")}`);
  }
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

    // 依赖失败传播：失败/跳过步骤的下游（含传递）标记 skipped，不再执行。
    if (propagateDependencySkips(workflow)) {
      emitProgress(workflow, options);
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

    // 并行派发上限（对齐工具并发策略 LAWMIND_MAX_TOOL_CONCURRENCY，默认 4）：
    // 避免大量就绪步骤同时起子会话，对模型端/磁盘造成无节流压力。
    const cap = Math.max(1, getMaxToolUseConcurrency());
    for (let i = 0; i < readySteps.length; i += cap) {
      if (abortRequested(options)) {
        break;
      }
      await Promise.all(
        readySteps
          .slice(i, i + cap)
          .map((step) => executeStep(baseConfig, workflow, step, options)),
      );
    }

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
  const awaitingLawyer = workflow.steps.some((s) => s.status === "awaiting_lawyer");

  if (anyFailed) {
    workflow.status = "failed";
    emitWorkflowEvent(baseConfig.workspaceDir, workflow, "workflow.failed");
  } else if (awaitingLawyer) {
    workflow.status = "awaiting_lawyer";
    workflow.updatedAt = new Date().toISOString();
  } else if (allCompleted) {
    workflow.status = "completed";
    emitWorkflowEvent(baseConfig.workspaceDir, workflow, "workflow.completed");
  }

  return workflow;
}

/**
 * Build a workflow summary report suitable for showing to the lawyer.
 */
export function buildWorkflowReport(workflow: CollaborationWorkflow): string {
  const lines: string[] = [];

  lines.push(`# 协作工作流报告：${workflow.name}`);
  lines.push(`状态：${workflowStatusLabel(workflow.status)}`);
  lines.push(`案件：${workflow.matterId ?? "（无关联案件）"}`);
  lines.push("");

  for (const step of workflow.steps) {
    const statusEmoji =
      step.status === "completed"
        ? "✅"
        : step.status === "failed"
          ? "❌"
          : step.status === "awaiting_lawyer"
            ? "待确认"
            : "⏳";
    lines.push(`## ${statusEmoji} 步骤：${step.task.slice(0, 80)}`);
    lines.push(`- 执行者：${step.assignee}`);
    lines.push(`- 状态：${stepStatusLabel(step.status)}`);
    if (step.roleMissNote?.trim()) {
      lines.push(`- 岗位：${step.roleMissNote.trim()}`);
    }
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
