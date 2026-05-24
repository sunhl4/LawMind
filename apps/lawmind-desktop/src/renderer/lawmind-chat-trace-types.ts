export type ChatTraceStep = {
  id: string;
  kind: "round" | "tool" | "workflow";
  label: string;
  status: "running" | "done" | "failed";
  detail?: string;
};

export type ChatLiveTrace = {
  active: boolean;
  currentRound?: number;
  steps: ChatTraceStep[];
};

/** 比较轨迹内容，避免轮询/SSE 重复 setState 导致 UI 频闪 */
export function liveTracesEqual(a?: ChatLiveTrace, b?: ChatLiveTrace): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return !a && !b;
  }
  if (a.active !== b.active || (a.currentRound ?? 0) !== (b.currentRound ?? 0)) {
    return false;
  }
  if (a.steps.length !== b.steps.length) {
    return false;
  }
  for (let i = 0; i < a.steps.length; i++) {
    const sa = a.steps[i];
    const sb = b.steps[i];
    if (
      sa.id !== sb.id ||
      sa.kind !== sb.kind ||
      sa.label !== sb.label ||
      sa.status !== sb.status ||
      (sa.detail ?? "") !== (sb.detail ?? "")
    ) {
      return false;
    }
  }
  return true;
}
