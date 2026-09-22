import { apiSendJson } from "./api-client";
import type { ChatMsg } from "./lawmind-chat";

export type SessionMutateMode = "truncate" | "delete_pair";

export type SessionMutateResponse = {
  ok?: boolean;
  error?: string;
  removedCount?: number;
  messages?: Array<{ role: string; text?: string; content?: string }>;
};

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
