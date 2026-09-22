import type { TaskExecutionState } from "../../../../src/lawmind/platform/contracts.ts";

const STATUS_LABEL: Record<TaskExecutionState["status"], string> = {
  running: "进行中",
  awaiting_approval: "待审批",
  awaiting_clarification: "待澄清",
  completed: "已完成",
  failed: "失败",
};

const PHASE_LABEL: Record<TaskExecutionState["phase"], string> = {
  clarify: "澄清",
  plan: "计划",
  research: "研判",
  draft: "起草",
  approval: "审批",
  render: "渲染",
  complete: "完成",
  error: "异常",
};

/** 审核台与对话执行轨迹共用的 executionState 中文标签 */
export function formatExecutionStateLabel(state: TaskExecutionState | null | undefined): string | null {
  if (!state?.phase || !state?.status) {
    return null;
  }
  return `${PHASE_LABEL[state.phase]} · ${STATUS_LABEL[state.status]}`;
}
