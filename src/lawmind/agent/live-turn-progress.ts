import type { TaskExecutionState } from "../platform/contracts.js";
import type { RunTurnEvent } from "./runtime.js";
import type { PersistedChatLiveTrace } from "./types.js";

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

function toolLabel(toolName: string): string {
  const map: Record<string, string> = {
    execute_workflow: "执行工作流",
    research_task: "法规检索",
    draft_document: "生成草稿",
    update_draft: "更新草稿",
    render_document: "渲染 Word",
    write_document: "写回草稿",
    search_workspace: "检索工作区",
    read_project_file: "读取项目文件",
    delegate_task: "委派任务",
    web_search: "联网搜索",
    search_statute_web: "法规联网检索",
  };
  return map[toolName] ?? toolName;
}

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
    case "tool_call_start":
      next.steps.push({
        id: event.toolCallId || `tool-${next.steps.length}`,
        kind: "tool",
        label: toolLabel(event.toolName),
        status: "running",
      });
      break;
    case "tool_progress":
      next.steps.push({
        id: `wf-${next.steps.length}-${Date.now()}`,
        kind: "workflow",
        label: event.label,
        status: "running",
      });
      break;
    case "tool_call_end": {
      const idx = [...next.steps]
        .toReversed()
        .findIndex((s) => s.kind === "tool" && s.status === "running");
      if (idx >= 0) {
        const realIdx = next.steps.length - 1 - idx;
        const row = next.steps[realIdx];
        next.steps[realIdx] = {
          ...row,
          status: event.ok ? "done" : "failed",
          detail: event.error,
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
    default:
      break;
  }

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
