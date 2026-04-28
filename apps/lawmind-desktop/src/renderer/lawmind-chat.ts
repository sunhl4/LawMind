import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import { chatErrorUserText, readJsonFromResponse, type ApiErrorJson } from "./api-client";
import { readIncludeTurnDiagnostics } from "./lawmind-chat-diagnostics-pref";

/** Mirrors `GET /api/chat` `runtimeHints` when Firm/Private or `includeTurnDiagnostics`. */
export type ChatRuntimeHints = {
  lawmindRouterMode: string;
  lawmindReasoningMode: string;
  toolCallsExecuted: number;
};

export type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  status?: string;
  clarificationQuestions?: ClarificationQuestion[];
  memorySources?: MemorySourceLayer[];
  toolCallSequence?: string[];
  /** Present on assistant messages when the server included turn diagnostics. */
  runtimeHints?: ChatRuntimeHints;
};

export function parseRuntimeHintsFromResponse(raw: unknown): ChatRuntimeHints | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.lawmindRouterMode !== "string" || typeof o.lawmindReasoningMode !== "string") {
    return undefined;
  }
  const toolCallsExecuted =
    typeof o.toolCallsExecuted === "number" && Number.isFinite(o.toolCallsExecuted)
      ? o.toolCallsExecuted
      : 0;
  return {
    lawmindRouterMode: o.lawmindRouterMode.trim() || "keyword",
    lawmindReasoningMode: o.lawmindReasoningMode.trim() || "off",
    toolCallsExecuted,
  };
}

/** True when the assistant is waiting for the lawyer to clarify or confirm before continuing. */
export type PendingClarificationState = {
  pending: boolean;
  /** Number of structured clarification items (0 if status-only awaiting). */
  count: number;
  /** Index in `messages` of that assistant turn, or -1. */
  assistantMessageIndex: number;
};

/**
 * Whether the current thread is blocked on the lawyer (last message is assistant
 * and there are open clarification questions and/or awaiting_clarification).
 */
/** Latest assistant turn that carried server `runtimeHints` (for the context strip). */
export function lastAssistantRuntimeHints(messages: ChatMsg[]): ChatRuntimeHints | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant" && m.runtimeHints) {
      return m.runtimeHints;
    }
  }
  return null;
}

export function getPendingClarificationState(messages: ChatMsg[]): PendingClarificationState {
  if (messages.length === 0) {
    return { pending: false, count: 0, assistantMessageIndex: -1 };
  }
  const last = messages[messages.length - 1];
  if (last.role !== "assistant") {
    return { pending: false, count: 0, assistantMessageIndex: -1 };
  }
  const qs = last.clarificationQuestions ?? [];
  const count = qs.length;
  if (count > 0) {
    return { pending: true, count, assistantMessageIndex: messages.length - 1 };
  }
  if (last.status === "awaiting_clarification") {
    return { pending: true, count: 0, assistantMessageIndex: messages.length - 1 };
  }
  return { pending: false, count: 0, assistantMessageIndex: -1 };
}

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
  status?: string;
  clarificationQuestions?: ClarificationQuestion[];
  memorySources?: MemorySourceLayer[];
  toolCallSequence?: string[];
  runtimeHints?: unknown;
};

export async function sendChatTurn(args: SendChatTurnArgs): Promise<{
  sessionId?: string;
  assistantMessage: ChatMsg;
}> {
  const includeTurnDiagnostics = readIncludeTurnDiagnostics();
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
      ...(includeTurnDiagnostics ? { includeTurnDiagnostics: true } : {}),
    }),
  });
  const body = await readJsonFromResponse<ChatResponse>(response);
  if (!response.ok || body.ok === false) {
    throw new Error(chatErrorUserText(response.status, body as ApiErrorJson));
  }
  const memorySources = Array.isArray(body.memorySources) ? body.memorySources : undefined;
  const clarificationQuestions = Array.isArray(body.clarificationQuestions)
    ? body.clarificationQuestions.filter(
        (item): item is ClarificationQuestion =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { key?: unknown }).key === "string" &&
          typeof (item as { question?: unknown }).question === "string",
      )
    : [];
  const rawSequence = Array.isArray(body.toolCallSequence) ? body.toolCallSequence : [];
  const toolCallSequence = rawSequence.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  const runtimeHints = parseRuntimeHintsFromResponse(body.runtimeHints);
  return {
    sessionId: body.sessionId,
    assistantMessage: {
      role: "assistant",
      text: body.reply || "(empty)",
      ...(typeof body.status === "string" && body.status.trim() ? { status: body.status } : {}),
      ...(clarificationQuestions.length > 0 ? { clarificationQuestions } : {}),
      ...(memorySources && memorySources.length > 0 ? { memorySources } : {}),
      ...(toolCallSequence.length > 0 ? { toolCallSequence } : {}),
      ...(runtimeHints ? { runtimeHints } : {}),
    },
  };
}

/** Build a user message that carries structured answers to clarification prompts. */
export function formatClarificationReply(
  questions: ClarificationQuestion[],
  answers: Record<string, string>,
): string {
  const blocks: string[] = [];
  for (const q of questions) {
    const raw = answers[q.key];
    const a = typeof raw === "string" ? raw.trim() : "";
    if (!a) {
      continue;
    }
    blocks.push(`### ${q.question}`, "", a, "");
  }
  if (blocks.length === 0) {
    return "";
  }
  return [
    "【补充信息】（请据此继续完善草稿并推进交付）",
    "",
    ...blocks,
    "请继续处理上述补充内容。",
  ].join("\n");
}

/** 将待澄清问题列成可编辑摘要，预填到主输入区（自然语言补全用）。 */
export function formatClarificationPromptSummary(questions: ClarificationQuestion[]): string {
  if (questions.length === 0) {
    return "";
  }
  const lines = questions.map((q, i) => `${i + 1}. ${q.question.trim()}`);
  return ["请按下面几点说明（可逐条写）：", "", ...lines, ""].join("\n");
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
