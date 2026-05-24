import type { ChatLiveTrace } from "./lawmind-chat-trace-types.js";
import { humanToolLabel } from "./lawmind-chat-trace.js";

export type ChatActivityTextBlock = {
  id: string;
  kind: "text";
  content: string;
};

export type ChatActivityToolBlock = {
  id: string;
  kind: "tool";
  toolCallId: string;
  toolName: string;
  label: string;
  status: "running" | "done" | "failed";
  detail?: string;
  progress: string[];
};

export type ChatActivityBlock = ChatActivityTextBlock | ChatActivityToolBlock;

export function createEmptyActivity(): ChatActivityBlock[] {
  return [];
}

export function appendActivityDelta(blocks: ChatActivityBlock[], text: string): ChatActivityBlock[] {
  if (!text) {
    return blocks;
  }
  const next = [...blocks];
  const last = next[next.length - 1];
  if (last?.kind === "text") {
    next[next.length - 1] = { ...last, content: last.content + text };
    return next;
  }
  next.push({ id: `text-${next.length}-${Date.now()}`, kind: "text", content: text });
  return next;
}

export function startActivityTool(
  blocks: ChatActivityBlock[],
  info: { toolCallId: string; toolName: string },
): ChatActivityBlock[] {
  const toolCallId = info.toolCallId?.trim() || `tool-${blocks.length}`;
  if (blocks.some((b) => b.kind === "tool" && b.toolCallId === toolCallId && b.status === "running")) {
    return blocks;
  }
  return [
    ...blocks,
    {
      id: toolCallId,
      kind: "tool",
      toolCallId,
      toolName: info.toolName,
      label: humanToolLabel(info.toolName),
      status: "running",
      progress: [],
    },
  ];
}

export function appendActivityToolProgress(
  blocks: ChatActivityBlock[],
  info: { toolCallId?: string; label: string },
): ChatActivityBlock[] {
  const label = info.label.trim();
  if (!label) {
    return blocks;
  }
  const next = [...blocks];
  const toolId = info.toolCallId?.trim();
  let idx = -1;
  if (toolId) {
    idx = next.findIndex((b) => b.kind === "tool" && b.toolCallId === toolId);
  }
  if (idx < 0) {
    for (let i = next.length - 1; i >= 0; i--) {
      const row = next[i];
      if (row.kind === "tool" && row.status === "running") {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) {
    return next;
  }
  const row = next[idx] as ChatActivityToolBlock;
  if (row.progress[row.progress.length - 1] === label) {
    return blocks;
  }
  next[idx] = { ...row, progress: [...row.progress, label] };
  return next;
}

export function endActivityTool(
  blocks: ChatActivityBlock[],
  info: { toolCallId: string; toolName: string; ok: boolean; error?: string },
): ChatActivityBlock[] {
  const next = [...blocks];
  const toolId = info.toolCallId?.trim();
  let idx = -1;
  if (toolId) {
    idx = next.findIndex((b) => b.kind === "tool" && b.toolCallId === toolId);
  }
  if (idx < 0) {
    for (let i = next.length - 1; i >= 0; i--) {
      const row = next[i];
      if (row.kind === "tool" && row.status === "running") {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) {
    return blocks;
  }
  const row = next[idx] as ChatActivityToolBlock;
  next[idx] = {
    ...row,
    label: humanToolLabel(info.toolName),
    status: info.ok ? "done" : "failed",
    detail: info.error,
  };
  return next;
}

export function finalizeActivity(blocks: ChatActivityBlock[]): ChatActivityBlock[] {
  return blocks.map((b) =>
    b.kind === "tool" && b.status === "running" ? { ...b, status: "done" as const } : b,
  );
}

export function finalizeActivityFailed(blocks: ChatActivityBlock[]): ChatActivityBlock[] {
  return blocks.map((b) =>
    b.kind === "tool" && b.status === "running" ? { ...b, status: "failed" as const } : b,
  );
}

/** 从活动流提取最终可见回复（优先最后一段文本） */
export function textFromActivity(blocks: ChatActivityBlock[]): string {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const row = blocks[i];
    if (row.kind === "text" && row.content.trim()) {
      return row.content.trim();
    }
  }
  return "";
}

export function activityFromLiveTrace(trace?: ChatLiveTrace): ChatActivityBlock[] {
  if (!trace?.steps.length) {
    return [];
  }
  const blocks: ChatActivityBlock[] = [];
  for (const step of trace.steps) {
    if (step.kind === "round") {
      continue;
    }
    if (step.kind === "workflow") {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "tool" && last.status === "running") {
        if (last.progress[last.progress.length - 1] !== step.label) {
          blocks[blocks.length - 1] = {
            ...last,
            progress: [...last.progress, step.label],
          };
        }
      } else {
        blocks.push({
          id: step.id,
          kind: "tool",
          toolCallId: step.id,
          toolName: "execute_workflow",
          label: step.label,
          status: step.status,
          detail: step.detail,
          progress: [],
        });
      }
      continue;
    }
    blocks.push({
      id: step.id,
      kind: "tool",
      toolCallId: step.id,
      toolName: "tool",
      label: step.label,
      status: step.status,
      detail: step.detail,
      progress: [],
    });
  }
  return blocks;
}

export function resolveMessageActivity(msg: {
  activity?: ChatActivityBlock[];
  liveTrace?: ChatLiveTrace;
}): ChatActivityBlock[] {
  if (msg.activity?.length) {
    return msg.activity;
  }
  return activityFromLiveTrace(msg.liveTrace);
}

export function activityBlocksEqual(a: ChatActivityBlock[], b: ChatActivityBlock[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const sa = a[i];
    const sb = b[i];
    if (sa.kind !== sb.kind || sa.id !== sb.id) {
      return false;
    }
    if (sa.kind === "text" && sb.kind === "text") {
      if (sa.content !== sb.content) {
        return false;
      }
      continue;
    }
    if (sa.kind === "tool" && sb.kind === "tool") {
      if (
        sa.toolCallId !== sb.toolCallId ||
        sa.toolName !== sb.toolName ||
        sa.label !== sb.label ||
        sa.status !== sb.status ||
        (sa.detail ?? "") !== (sb.detail ?? "") ||
        sa.progress.length !== sb.progress.length
      ) {
        return false;
      }
      for (let j = 0; j < sa.progress.length; j++) {
        if (sa.progress[j] !== sb.progress[j]) {
          return false;
        }
      }
    }
  }
  return true;
}
