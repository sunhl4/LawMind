import type { TranscriptBubble } from "../../../../src/lawmind/agent/resolve-transcript-cut.ts";
import { parseRequiresActionsFromResponse } from "./lawmind-requires-action";
import { apiGetJson, apiSendJson } from "./api-client";
import type { ChatMsg } from "./lawmind-chat";

export type SessionMutateMode = "truncate" | "delete_pair";

export type SessionMutateResponse = {
  ok?: boolean;
  error?: string;
  removedCount?: number;
  messages?: Array<{ role: string; text?: string; content?: string }>;
};

export type ChatSessionSnapshot = {
  messages: ChatMsg[];
  latestTurn?: { turnId: string; status: string; startedAt: string; completedAt?: string; interrupted?: boolean };
};

export async function fetchChatSessionSnapshot(
  apiBase: string,
  sessionId: string,
  assistantId: string,
  signal?: AbortSignal,
): Promise<ChatSessionSnapshot> {
  const j = await apiGetJson<{
    ok?: boolean;
    latestTurn?: ChatSessionSnapshot["latestTurn"];
    messages?: Array<{ role: string; text?: string; content?: string;
      requiresAction?: unknown; liveTrace?: ChatMsg["liveTrace"];
      executionState?: ChatMsg["executionState"]; turnPlan?: ChatMsg["turnPlan"] }>;
  }>(
    apiBase,
    `/api/sessions/${encodeURIComponent(sessionId)}?assistantId=${encodeURIComponent(assistantId)}`,
    { signal },
  );
  if (!j.ok || !Array.isArray(j.messages)) {
    throw new Error("读取对话失败");
  }
  const messages = j.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as TranscriptBubble["role"],
      ...(message.liveTrace ? { liveTrace: message.liveTrace } : {}),
      ...(message.executionState ? { executionState: message.executionState } : {}),
      ...(message.turnPlan ? { turnPlan: message.turnPlan } : {}),
      ...(message.requiresAction ? { requiresAction: parseRequiresActionsFromResponse(message.requiresAction) } : {}),
      text:
        typeof message.text === "string"
          ? message.text
          : typeof message.content === "string"
            ? message.content
            : "",
    }));
  return { messages, latestTurn: j.latestTurn };
}

export async function fetchSessionBubbles(
  apiBase: string, sessionId: string, assistantId: string, signal?: AbortSignal,
): Promise<ChatMsg[]> {
  return (await fetchChatSessionSnapshot(apiBase, sessionId, assistantId, signal)).messages;
}

export async function mutateSessionMessages(
  apiBase: string,
  sessionId: string,
  opts: { uiIndex: number; mode: SessionMutateMode },
): Promise<{ messages: ChatMsg[]; removedCount: number }> {
  const j = await apiSendJson<SessionMutateResponse, { uiIndex: number; mode: SessionMutateMode }>(
    apiBase,
    `/api/sessions/${encodeURIComponent(sessionId)}/messages/mutate`,
    "POST",
    { uiIndex: opts.uiIndex, mode: opts.mode },
  );
  if (!j.ok) {
    throw new Error(j.error ?? "修改对话失败");
  }
  const messages: ChatMsg[] = (j.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      text: typeof m.text === "string" ? m.text : typeof m.content === "string" ? m.content : "",
    }));
  return { messages, removedCount: j.removedCount ?? 0 };
}

export async function abortSessionTurn(apiBase: string, sessionId: string): Promise<void> {
  try {
    await apiSendJson<{ ok?: boolean }, Record<string, never>>(
      apiBase,
      `/api/sessions/${encodeURIComponent(sessionId)}/abort`,
      "POST",
      {},
    );
  } catch {
    /* best-effort — client AbortController still stops the stream */
  }
}

export function simpleMessagesToChatMsgs(
  rows: Array<{ role: string; text?: string; content?: string }>,
): ChatMsg[] {
  return rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      text: typeof m.text === "string" ? m.text : typeof m.content === "string" ? m.content : "",
    }));
}
