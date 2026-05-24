/**
 * Platform execution state — TaskExecutionState + GateDecision helpers.
 * See docs/lawmind/LAWMIND-PLATFORM-CONTRACTS.md §2–3.
 */

import type { AgentTurn } from "../agent/types.js";
import type { GateDecision, TaskExecutionState } from "./contracts.js";

export function executionStateFromTurn(
  turn: Pick<AgentTurn, "status" | "error">,
): TaskExecutionState {
  const gate = turn.status;
  if (gate === "awaiting_approval") {
    return {
      phase: "approval",
      status: "awaiting_approval",
      recoverable: true,
      detail: "等待律师审批后继续执行。",
    };
  }
  if (gate === "awaiting_clarification") {
    return {
      phase: "clarify",
      status: "awaiting_clarification",
      recoverable: true,
      detail: "等待律师补充关键信息。",
    };
  }
  if (gate === "error") {
    return {
      phase: "error",
      status: "failed",
      recoverable: false,
      detail: turn.error,
    };
  }
  if (gate === "running") {
    return {
      phase: "plan",
      status: "running",
      recoverable: true,
      detail: "执行中。",
    };
  }
  return {
    phase: "complete",
    status: "completed",
    recoverable: true,
    detail: "本轮执行完成。",
  };
}

export function isAwaitingClarification(
  executionState?: TaskExecutionState | null,
  gateDecisions?: GateDecision[] | null,
): boolean {
  if (executionState?.status === "awaiting_clarification") {
    return true;
  }
  return (
    gateDecisions?.some(
      (g) =>
        g.gate === "clarification_gate" &&
        (g.decision === "block" || g.decision === "awaiting_confirmation"),
    ) ?? false
  );
}

export function isAwaitingApproval(
  executionState?: TaskExecutionState | null,
  gateDecisions?: GateDecision[] | null,
): boolean {
  if (executionState?.status === "awaiting_approval") {
    return true;
  }
  return (
    gateDecisions?.some(
      (g) =>
        (g.gate === "approval_gate" || g.gate === "dangerous_tool_gate") &&
        g.decision === "awaiting_confirmation",
    ) ?? false
  );
}

export function mergeExecutionState(
  base: TaskExecutionState,
  patch: Partial<TaskExecutionState>,
): TaskExecutionState {
  return { ...base, ...patch };
}
