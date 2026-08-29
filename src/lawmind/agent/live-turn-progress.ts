import type { TaskExecutionState } from "../platform/contracts.js";
import { MAX_LIVE_TURN_STEPS } from "./embed-turn-events.js";
import type { RunTurnEvent } from "./runtime.js";
import { presentLawyerToolCall, presentLawyerToolResult } from "./tool-lawyer-card.js";
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
  status: "running" | "done" | "failed";
  detail?: string;
};

export type LiveTurnProgress = {
  sessionId: string;
  status: "running" | "completed" | "failed";
  currentRound: number;
  steps: LiveTurnStep[];
  updatedAt: string;
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
        label: `第 ${event.roundIndex} 轮推理`,
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
      const idx = [...next.steps]
        .toReversed()
        .findIndex((s) => s.kind === "tool" && s.status === "running");
      if (idx >= 0) {
        const realIdx = next.steps.length - 1 - idx;
        const row = next.steps[realIdx];
        next.steps[realIdx] = {
          ...row,
          status: event.ok ? "done" : "failed",
          detail,
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
    case "final":
      next.status = event.status === "error" ? "failed" : "completed";
      for (let i = 0; i < next.steps.length; i++) {
        if (next.steps[i].status === "running") {
          next.steps[i] = { ...next.steps[i], status: "done" };
        }
      }
      break;
    case "clarification":
      break;
    case "tool_budget":
      if (event.level === "warn") {
        next.steps.push({
          id: `tool-budget-${next.steps.length}`,
          kind: "round",
          label: `工具调用将触顶（${event.used}/${event.maxToolCalls}）`,
          status: "done",
        });
      }
      break;
    case "overflow_prune":
      next.steps.push({
        id: `overflow-prune-${next.steps.length}`,
        kind: "round",
        label: "上下文较满，已精简后继续",
        status: "done",
        detail: event.prunedCount > 0 ? `精简 ${event.prunedCount} 条工具结果` : undefined,
      });
      break;
    default:
      break;
  }

  next.steps = boundLiveTurnSteps(next.steps);
  store.set(sessionId, next);
}

export function finishLiveTurnProgress(
  sessionId: string,
  status: "completed" | "failed" = "completed",
): void {
  const current = store.get(sessionId);
  if (!current) {
    return;
  }
  store.set(sessionId, {
    ...current,
    status,
    updatedAt: new Date().toISOString(),
    steps: current.steps.map((s) =>
      s.status === "running" ? { ...s, status: status === "failed" ? "failed" : "done" } : s,
    ),
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
    })),
  };
}

export function attachPersistedLiveTraceToLastAssistant(
  session: {
    conversationHistory: Array<{
      role: string;
      liveTrace?: PersistedChatLiveTrace;
      executionState?: TaskExecutionState;
    }>;
  },
  liveProgressKey: string,
  executionState?: TaskExecutionState,
): void {
  const trace = liveProgressToPersistedTrace(liveProgressKey);
  if (!trace && !executionState) {
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
