import type { ChatSessionRef } from "./lawmind-session-link";

export type ChatTraceStep = {
  id: string;
  kind: "round" | "tool" | "workflow";
  label: string;
  status: "running" | "done" | "failed";
  detail?: string;
  sessionRefs?: ChatSessionRef[];
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
      (sa.detail ?? "") !== (sb.detail ?? "") ||
      (sa.sessionRefs?.length ?? 0) !== (sb.sessionRefs?.length ?? 0)
    ) {
      return false;
    }
    const ra = sa.sessionRefs ?? [];
    const rb = sb.sessionRefs ?? [];
    for (let j = 0; j < ra.length; j++) {
      if (
        ra[j]?.sessionId !== rb[j]?.sessionId ||
        ra[j]?.title !== rb[j]?.title ||
        (ra[j]?.assistantId ?? "") !== (rb[j]?.assistantId ?? "")
      ) {
        return false;
      }
    }
  }
  return true;
}
