import type { ChatLiveTrace, ChatTraceStep } from "./lawmind-chat-trace-types.js";

export type { ChatLiveTrace, ChatTraceStep };
export { liveTracesEqual } from "./lawmind-chat-trace-types.js";

export function humanToolLabel(toolName: string): string {
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
    plan_task: "任务规划",
  };
  return map[toolName] ?? "调用工具";
}

/** 已完成轨迹的一行摘要（Cursor 式折叠标题） */
export function summarizeLiveTrace(trace: ChatLiveTrace | undefined): string | null {
  if (!trace?.steps.length) {
    return trace?.active ? "正在处理…" : null;
  }
  const steps = trace.steps;
  const doneCount = steps.filter((s) => s.status === "done").length;
  const failed = steps.some((s) => s.status === "failed");
  const last = [...steps].toReversed().find((s) => s.kind === "tool" || s.kind === "workflow") ?? steps[steps.length - 1];
  const lastLabel = last?.label?.trim() || "处理";
  if (trace.active) {
    const running = [...steps].toReversed().find((s) => s.status === "running");
    return running ? `正在：${running.label}` : `已执行 ${doneCount} 步`;
  }
  if (failed) {
    return "未能完成本轮处理";
  }
  return `已完成 ${doneCount} 步 · ${lastLabel}`;
}

export function createEmptyLiveTrace(): ChatLiveTrace {
  return { active: true, steps: [], currentRound: 0 };
}

export function applyRoundStart(trace: ChatLiveTrace, roundIndex: number): ChatLiveTrace {
  return {
    ...trace,
    active: true,
    currentRound: roundIndex,
    steps: [
      ...trace.steps,
      {
        id: `round-${roundIndex}`,
        kind: "round",
        label: `第 ${roundIndex} 轮推理`,
        status: "running",
      },
    ],
  };
}

export function applyToolStart(
  trace: ChatLiveTrace,
  info: { toolCallId: string; toolName: string },
): ChatLiveTrace {
  return {
    ...trace,
    steps: [
      ...trace.steps,
      {
        id: info.toolCallId || `tool-${trace.steps.length}`,
        kind: "tool",
        label: humanToolLabel(info.toolName),
        status: "running",
      },
    ],
  };
}

export function applyToolProgress(trace: ChatLiveTrace, label: string): ChatLiveTrace {
  return {
    ...trace,
    steps: [
      ...trace.steps,
      {
        id: `wf-${trace.steps.length}-${Date.now()}`,
        kind: "workflow",
        label,
        status: "running",
      },
    ],
  };
}

export function applyToolEnd(
  trace: ChatLiveTrace,
  info: { toolCallId: string; toolName: string; ok: boolean; error?: string },
): ChatLiveTrace {
  const steps = [...trace.steps];
  const toolId = info.toolCallId?.trim();
  let toolClosed = false;
  if (toolId) {
    const byId = steps.findIndex((row) => row.kind === "tool" && row.id === toolId);
    if (byId >= 0 && steps[byId].status === "running") {
      steps[byId] = {
        ...steps[byId],
        status: info.ok ? "done" : "failed",
        detail: info.error,
      };
      toolClosed = true;
    }
  }
  if (!toolClosed) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const row = steps[i];
      if (row.kind === "tool" && row.status === "running") {
        steps[i] = {
          ...row,
          status: info.ok ? "done" : "failed",
          detail: info.error,
        };
        break;
      }
    }
  }
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind === "workflow" && steps[i].status === "running") {
      steps[i] = { ...steps[i], status: info.ok ? "done" : "failed" };
    }
  }
  return { ...trace, steps };
}

export function finalizeLiveTrace(trace: ChatLiveTrace): ChatLiveTrace {
  return {
    ...trace,
    active: false,
    steps: trace.steps.map((s) =>
      s.status === "running" ? { ...s, status: "done" as const } : s,
    ),
  };
}

/** 发送失败或中断时：仍在运行的步骤标记为 failed */
export function finalizeLiveTraceFailed(trace: ChatLiveTrace): ChatLiveTrace {
  return {
    ...trace,
    active: false,
    steps: trace.steps.map((s) =>
      s.status === "running" ? { ...s, status: "failed" as const } : s,
    ),
  };
}

export function liveTraceFromServerProgress(input: {
  status?: string;
  currentRound?: number;
  steps?: Array<{ id: string; kind: string; label: string; status: string; detail?: string }>;
}): ChatLiveTrace {
  const steps: ChatTraceStep[] = (input.steps ?? []).map((s) => ({
    id: s.id,
    kind: s.kind === "workflow" ? "workflow" : s.kind === "round" ? "round" : "tool",
    label: s.label,
    status: s.status === "failed" ? "failed" : s.status === "done" ? "done" : "running",
    detail: s.detail,
  }));
  return {
    active: input.status === "running",
    currentRound: input.currentRound ?? 0,
    steps,
  };
}

export function mergeDelegationLiveTraces(
  items: Array<{
    toAssistant: string;
    progress?: {
      status?: string;
      currentRound?: number;
      steps?: Array<{ id: string; kind: string; label: string; status: string; detail?: string }>;
    } | null;
  }>,
  assistantDisplayById?: Record<string, string>,
): ChatLiveTrace | undefined {
  const steps: ChatTraceStep[] = [];
  let currentRound = 0;
  let anyActive = false;
  for (const item of items) {
    const progress = item.progress;
    if (!progress?.steps?.length) {
      continue;
    }
    if (progress.status === "running") {
      anyActive = true;
    }
    currentRound = Math.max(currentRound, progress.currentRound ?? 0);
    const rawId = item.toAssistant.trim();
    const prefix = assistantDisplayById?.[rawId]?.trim() || rawId || "子助手";
    for (const step of progress.steps) {
      steps.push({
        id: `${prefix}-${step.id}`,
        kind: step.kind === "workflow" ? "workflow" : step.kind === "round" ? "round" : "tool",
        label: `[${prefix}] ${step.label}`,
        status: step.status === "failed" ? "failed" : step.status === "done" ? "done" : "running",
        detail: step.detail,
      });
    }
  }
  if (steps.length === 0) {
    return undefined;
  }
  return { active: anyActive, currentRound, steps };
}

export async function fetchDelegationSessionProgress(
  apiBase: string,
  sessionId: string,
  assistantId: string,
  signal?: AbortSignal,
): Promise<{
  items: Array<{
    delegationId: string;
    toAssistant: string;
    targetSessionId?: string;
    progress: Awaited<ReturnType<typeof fetchChatLiveTurnProgress>>["progress"];
  }>;
}> {
  const r = await fetch(
    `${apiBase}/api/delegations/session-progress?sessionId=${encodeURIComponent(sessionId)}&assistantId=${encodeURIComponent(assistantId)}`,
    { signal },
  );
  const j = (await r.json()) as {
    ok?: boolean;
    items?: Array<{
      delegationId?: string;
      toAssistant?: string;
      targetSessionId?: string;
      progress?: Awaited<ReturnType<typeof fetchChatLiveTurnProgress>>["progress"];
    }>;
  };
  if (!r.ok || j.ok === false || !Array.isArray(j.items)) {
    return { items: [] };
  }
  return {
    items: j.items.map((it) => ({
      delegationId: typeof it.delegationId === "string" ? it.delegationId : "",
      toAssistant: typeof it.toAssistant === "string" ? it.toAssistant : "",
      targetSessionId: typeof it.targetSessionId === "string" ? it.targetSessionId : undefined,
      progress: it.progress ?? null,
    })),
  };
}

export async function fetchChatLiveTurnProgress(
  apiBase: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<{
  progress: {
    status: string;
    currentRound?: number;
    steps?: Array<{ id: string; kind: string; label: string; status: string; detail?: string }>;
  } | null;
  idle: boolean;
}> {
  const r = await fetch(
    `${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/live-turn`,
    { signal },
  );
  const j = (await r.json()) as {
    ok?: boolean;
    progress?: {
      status: string;
      currentRound?: number;
      steps?: Array<{ id: string; kind: string; label: string; status: string; detail?: string }>;
    } | null;
    status?: string;
  };
  if (!r.ok || j.ok === false) {
    throw new Error("live_turn_fetch_failed");
  }
  if (j.progress) {
    return { progress: j.progress, idle: false };
  }
  return { progress: null, idle: j.status === "idle" };
}
