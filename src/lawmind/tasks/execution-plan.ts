/**
 * 业务语义执行步骤（与 `TaskRecord.status` 并存，供任务详情 / Matter UI 展示）。
 */

import type {
  TaskExecutionPlanStep,
  TaskIntent,
  TaskLifecycleStatus,
  TaskRecord,
} from "../types.js";

const ORDER: TaskLifecycleStatus[] = [
  "created",
  "confirmed",
  "researching",
  "researched",
  "drafted",
  "reviewed",
  "rejected",
  "rendered",
  "completed",
];

function statusRank(s: TaskLifecycleStatus): number {
  const i = ORDER.indexOf(s);
  return i >= 0 ? i : 0;
}

/** 新建任务时的步骤模板（状态均为 pending / 特殊 kind 除外）。 */
export function buildInitialExecutionPlan(intent: TaskIntent): TaskExecutionPlanStep[] {
  if (intent.kind === "agent.instruction") {
    return [
      { id: "chat", label: "对话指令已记录", status: "done" },
      { id: "turn", label: "助手回合完成", status: "pending" },
    ];
  }
  if (intent.kind === "unknown") {
    return [{ id: "clarify", label: "澄清任务范围与交付口径", status: "pending" }];
  }
  if (intent.kind.startsWith("research.")) {
    const steps: TaskExecutionPlanStep[] = [];
    if (intent.requiresConfirmation) {
      steps.push({ id: "confirm", label: "律师确认后再检索", status: "pending" });
    }
    steps.push(
      { id: "research", label: "检索与要点整理", status: "pending" },
      { id: "wrapup", label: "形成可交付结论", status: "pending" },
    );
    return steps;
  }
  const steps: TaskExecutionPlanStep[] = [];
  if (intent.requiresConfirmation) {
    steps.push({ id: "confirm", label: "律师确认任务", status: "pending" });
  }
  steps.push(
    { id: "research", label: "检索与事实整理", status: "pending" },
    { id: "draft", label: "生成正式草稿", status: "pending" },
    { id: "review", label: "律师审核", status: "pending" },
    { id: "render", label: "渲染交付物", status: "pending" },
  );
  return steps;
}

function reconcileStep(step: TaskExecutionPlanStep, record: TaskRecord): TaskExecutionPlanStep {
  const st = record.status;
  const r = statusRank(st);

  switch (step.id) {
    case "confirm":
      if (!record.requiresConfirmation) {
        return { ...step, status: "skipped" };
      }
      if (r >= statusRank("confirmed")) {
        return { ...step, status: "done" };
      }
      return { ...step, status: "pending" };
    case "research":
      if (r >= statusRank("researched")) {
        return { ...step, status: "done" };
      }
      if (r >= statusRank("researching")) {
        return { ...step, status: "pending" };
      }
      return { ...step, status: "pending" };
    case "draft":
      if (r >= statusRank("drafted") || st === "rejected") {
        return { ...step, status: "done" };
      }
      return { ...step, status: "pending" };
    case "review":
      if (st === "rejected" || r >= statusRank("reviewed")) {
        return { ...step, status: "done" };
      }
      return { ...step, status: "pending" };
    case "render":
      if (r >= statusRank("rendered") || st === "completed") {
        return { ...step, status: "done" };
      }
      return { ...step, status: "pending" };
    case "wrapup":
      if (
        record.kind.startsWith("research.") &&
        (st === "completed" || r >= statusRank("researched"))
      ) {
        return { ...step, status: "done" };
      }
      return { ...step, status: "pending" };
    case "clarify":
      if (st !== "created" || r >= statusRank("confirmed")) {
        return { ...step, status: "done" };
      }
      return { ...step, status: "pending" };
    case "chat":
      return { ...step, status: "done" };
    case "turn":
      if (st === "completed") {
        return { ...step, status: "done" };
      }
      return { ...step, status: "pending" };
    default:
      return step;
  }
}

export function buildInitialExecutionPlanFromRecord(record: TaskRecord): TaskExecutionPlanStep[] {
  return buildInitialExecutionPlan({
    taskId: record.taskId,
    kind: record.kind,
    output: record.output,
    instruction: record.instruction ?? "",
    summary: record.summary,
    riskLevel: record.riskLevel,
    requiresConfirmation: record.requiresConfirmation,
    createdAt: record.createdAt,
    models: [],
    audience: record.audience,
    matterId: record.matterId,
    templateId: record.templateId,
    deliverableType: record.deliverableType,
    acceptanceCriteria: record.acceptanceCriteria,
    clarificationQuestions: record.clarificationQuestions,
  });
}

/** 根据当前 `TaskRecord` 刷新步骤状态；若无持久化模板则按 kind 推导。 */
export function deriveExecutionPlanSteps(record: TaskRecord): TaskExecutionPlanStep[] {
  const base =
    record.executionPlan && record.executionPlan.length > 0
      ? record.executionPlan
      : buildInitialExecutionPlanFromRecord(record);
  return base.map((s) => reconcileStep({ ...s }, record));
}
