import type { TaskExecutionState } from "../platform/contracts.js";
import { MAX_LIVE_TURN_STEPS } from "./embed-turn-events.js";
import type { RunTurnEvent } from "./runtime.js";
import { presentLawyerToolCall, presentLawyerToolResult } from "./tool-lawyer-card.js";
import type { AgentTurnPlan } from "./turn-plan.js";
import type { PersistedChatLiveTrace } from "./types.js";

function boundLiveTurnSteps(steps: LiveTurnStep[]): LiveTurnStep[] {
  if (steps.length <= MAX_LIVE_TURN_STEPS) {
    return steps;
  }
  return steps.slice(-MAX_LIVE_TURN_STEPS);
}

export type LiveTurnStep = {
  id: string;
  kind: "round" | "tool" | "workflow";
  label: string;
  status: "running" | "done" | "failed" | "paused";
  detail?: string;
  sessionRefs?: Array<{
    sessionId: string;
    title: string;
    matterId?: string;
    assistantId?: string;
  }>;
};

export type LiveTurnProgress = {
  sessionId: string;
  /**
   * `paused` = 等律师确认/补充，不是成功也不是失败（2026-10-21 新增）。
   * 以前暂停先被写成 `completed`、随后被收尾改成 `failed`，界面自相矛盾。
   */
  status: "running" | "paused" | "completed" | "failed";
  currentRound: number;
  steps: LiveTurnStep[];
  updatedAt: string;
  turnPlan?: AgentTurnPlan;
  /** 连接中断、结果待对账；不等于工作没发生。 */
  needsReconcile?: boolean;
};

const store = new Map<string, LiveTurnProgress>();

export function beginLiveTurnProgress(sessionId: string): void {
  store.set(sessionId, {
    sessionId,
    status: "running",
    currentRound: 0,
    steps: [],
    updatedAt: new Date().toISOString(),
  });
}

export function applyLiveTurnEvent(sessionId: string, event: RunTurnEvent): void {
  const current = store.get(sessionId);
  if (!current) {
    return;
  }
  const next: LiveTurnProgress = {
    ...current,
    steps: [...current.steps],
    updatedAt: new Date().toISOString(),
  };

  switch (event.type) {
    case "round_start":
      next.currentRound = event.roundIndex;
      next.steps.push({
        id: `round-${event.roundIndex}`,
        kind: "round",
        label: "决定下一步",
        status: "running",
      });
      break;
    case "tool_call_start": {
      const card = presentLawyerToolCall(event.toolName, event.args ?? {});
      next.steps.push({
        id: event.toolCallId || `tool-${next.steps.length}`,
        kind: "tool",
        label: card.title,
        status: "running",
        detail: card.detail,
      });
      break;
    }
    case "tool_progress":
      next.steps.push({
        id: `wf-${next.steps.length}-${Date.now()}`,
        kind: "workflow",
        label: event.label,
        status: "running",
      });
      break;
    case "tool_call_end": {
      const resultCard = presentLawyerToolResult(
        event.toolName,
        {},
        {
          ok: event.ok,
          error: event.error,
        },
      );
      const detail = event.error?.trim() || event.resultPreview || resultCard.detail;
      const byId = event.toolCallId
        ? next.steps.findIndex((step) => step.kind === "tool" && step.id === event.toolCallId)
        : -1;
      const runningFromEnd = [...next.steps]
        .toReversed()
        .findIndex((step) => step.kind === "tool" && step.status === "running");
      const realIdx =
        byId >= 0 ? byId : runningFromEnd >= 0 ? next.steps.length - 1 - runningFromEnd : -1;
      if (realIdx >= 0) {
        const row = next.steps[realIdx];
        next.steps[realIdx] = {
          ...row,
          status: event.ok ? "done" : "failed",
          detail,
          ...(event.ok && event.sessionRefs && event.sessionRefs.length > 0
            ? { sessionRefs: event.sessionRefs }
            : {}),
        };
      }
      for (let i = 0; i < next.steps.length; i++) {
        if (next.steps[i].kind === "workflow" && next.steps[i].status === "running") {
          next.steps[i] = {
            ...next.steps[i],
            status: event.ok ? "done" : "failed",
          };
        }
      }
      break;
    }
    case "delta":
      break;
    case "approval_request":
      next.status = "paused";
      next.steps = next.steps.map((step) =>
        step.id === event.toolCallId ? { ...step, status: "paused", detail: "等待律师确认" } : step,
      );
      break;
    case "final":
      // 三种结局分开：成功、失败、以及「等律师」——暂停既不是成功也不是失败。
      // 旧实现把 paused 当 completed，随后收尾又把它改成 failed，界面同时说
      // 「失败」和「这步已完成」。
      next.status =
        event.status === "error"
          ? "failed"
          : event.status === "paused" ||
              event.status === "awaiting_approval" ||
              event.status === "awaiting_clarification"
            ? "paused"
            : "completed";
      next.steps = next.steps.map((step) =>
        step.status === "running"
          ? {
              ...step,
              status:
                next.status === "paused" ? "paused" : next.status === "failed" ? "failed" : "done",
            }
          : step,
      );
      break;
    case "clarification":
      break;
    case "plan_update":
      next.turnPlan = event.plan;
      break;
    case "intent":
      next.steps.push({
        id: `intent-${next.steps.length}`,
        kind: "round",
        label: event.lawyerSummary,
        status: "done",
      });
      break;
    case "tool_budget":
      if (event.level === "warn") {
        next.steps.push({
          id: `tool-budget-${next.steps.length}`,
          kind: "round",
          label: `本轮已办理 ${event.used} 步，继续办理中`,
          status: "done",
        });
      }
      break;
    case "overflow_prune":
      next.steps.push({
        id: `overflow-prune-${next.steps.length}`,
        kind: "round",
        label: "较早的检索结果已收短，继续办",
        status: "done",
        detail: event.prunedCount > 0 ? `收短了 ${event.prunedCount} 条较早的结果` : undefined,
      });
      break;
    case "verify_gap":
      for (let i = next.steps.length - 1; i >= 0; i--) {
        const step = next.steps[i];
        if (step?.kind === "round" && step.status === "running") {
          next.steps[i] = { ...step, status: "done" };
          break;
        }
      }
      next.steps.push({
        id: `verify-${next.steps.length}`,
        kind: "round",
        label: event.message.trim() || "验收未过",
        status: "done",
      });
      break;
    case "context_deferral_bounce":
      next.steps.push({
        id: `context-deferral-${next.steps.length}`,
        kind: "round",
        label: "这场对话已整理，继续办",
        status: "done",
      });
      break;
    case "compact_boundary":
      // 只有回合内的整理才值得进「在办」时间线；回合开始那次是常规维护。
      if (event.midTurn === true) {
        next.steps.push({
          id: `compact-${next.steps.length}`,
          kind: "round",
          label: "这场对话已整理，继续办",
          status: "done",
        });
      }
      break;
    default:
      break;
  }

  next.steps = boundLiveTurnSteps(next.steps);
  store.set(sessionId, next);
}

export function finishLiveTurnProgress(
  sessionId: string,
  status: "completed" | "failed" | "paused" = "completed",
): void {
  const current = store.get(sessionId);
  if (!current) {
    return;
  }
  store.set(sessionId, {
    ...current,
    status,
    updatedAt: new Date().toISOString(),
    steps: current.steps.map((step) =>
      step.status === "running"
        ? {
            ...step,
            status: status === "paused" ? "paused" : status === "failed" ? "failed" : "done",
          }
        : step,
    ),
  });
}

/**
 * 传输中断：只标「待对账」，不推断工作没发生。
 * 调用方应先拉一次会话详情，再决定要不要重发。
 */
export function markLiveTurnProgressNeedsReconcile(sessionId: string): void {
  const current = store.get(sessionId);
  if (!current) {
    return;
  }
  store.set(sessionId, {
    ...current,
    needsReconcile: true,
    updatedAt: new Date().toISOString(),
  });
}

export function getLiveTurnProgress(sessionId: string): LiveTurnProgress | undefined {
  return store.get(sessionId);
}

export function liveProgressToPersistedTrace(
  sessionId: string,
): PersistedChatLiveTrace | undefined {
  const progress = getLiveTurnProgress(sessionId);
  if (!progress || progress.steps.length === 0) {
    return undefined;
  }
  return {
    currentRound: progress.currentRound,
    steps: progress.steps.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      status: s.status,
      detail: s.detail,
      ...(s.sessionRefs && s.sessionRefs.length > 0 ? { sessionRefs: s.sessionRefs } : {}),
    })),
  };
}

export function attachPersistedLiveTraceToLastAssistant(
  session: {
    conversationHistory: Array<{
      role: string;
      liveTrace?: PersistedChatLiveTrace;
      executionState?: TaskExecutionState;
      turnPlan?: AgentTurnPlan;
    }>;
    turnPlan?: AgentTurnPlan;
  },
  liveProgressKey: string,
  executionState?: TaskExecutionState,
): void {
  const trace = liveProgressToPersistedTrace(liveProgressKey);
  const livePlan = getLiveTurnProgress(liveProgressKey)?.turnPlan ?? session.turnPlan;
  if (!trace && !executionState && !livePlan) {
    return;
  }
  for (let i = session.conversationHistory.length - 1; i >= 0; i--) {
    const row = session.conversationHistory[i];
    if (row.role !== "assistant") {
      continue;
    }
    if (trace) {
      row.liveTrace = trace;
    }
    if (executionState) {
      row.executionState = executionState;
    }
    if (livePlan) {
      row.turnPlan = livePlan;
    }
    break;
  }
}

export function clearLiveTurnProgress(sessionId: string): void {
  store.delete(sessionId);
}

/** Test helper */
export function resetLiveTurnProgressStore(): void {
  store.clear();
}
