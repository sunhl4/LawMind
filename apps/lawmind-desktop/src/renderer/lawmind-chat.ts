import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import { chatErrorUserText, type ApiErrorJson } from "./api-client";

export type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  memorySources?: MemorySourceLayer[];
  toolCallSequence?: string[];
};

type SendChatTurnArgs = {
  apiBase: string;
  message: string;
  sessionId?: string;
  assistantId: string;
  allowWebSearch: boolean;
  matterId?: string | null;
  projectDir?: string | null;
};

type ChatResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  error?: string;
  detail?: string;
  sessionId?: string;
  reply?: string;
  memorySources?: MemorySourceLayer[];
  toolCallSequence?: string[];
};

export async function sendChatTurn(args: SendChatTurnArgs): Promise<{
  sessionId?: string;
  assistantMessage: ChatMsg;
}> {
  const response = await fetch(`${args.apiBase}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: args.message,
      sessionId: args.sessionId,
      assistantId: args.assistantId,
      allowWebSearch: args.allowWebSearch,
      ...(args.matterId ? { matterId: args.matterId } : {}),
      ...(args.projectDir ? { projectDir: args.projectDir } : {}),
    }),
  });
  const body = (await response.json()) as ChatResponse;
  if (!response.ok || body.ok === false) {
    throw new Error(chatErrorUserText(response.status, body as ApiErrorJson));
  }
  const memorySources = Array.isArray(body.memorySources) ? body.memorySources : undefined;
  const rawSequence = Array.isArray(body.toolCallSequence) ? body.toolCallSequence : [];
  const toolCallSequence = rawSequence.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  return {
    sessionId: body.sessionId,
    assistantMessage: {
      role: "assistant",
      text: body.reply || "(empty)",
      ...(memorySources && memorySources.length > 0 ? { memorySources } : {}),
      ...(toolCallSequence.length > 0 ? { toolCallSequence } : {}),
    },
  };
}

export function appendChatMessage(
  messagesByAssistant: Record<string, ChatMsg[]>,
  assistantId: string,
  message: ChatMsg,
): Record<string, ChatMsg[]> {
  return {
    ...messagesByAssistant,
    [assistantId]: [...(messagesByAssistant[assistantId] ?? []), message],
  };
}

export function removeAssistantChatState<T>(
  stateByAssistant: Record<string, T>,
  assistantId: string,
): Record<string, T> {
  const next = { ...stateByAssistant };
  delete next[assistantId];
  return next;
}
