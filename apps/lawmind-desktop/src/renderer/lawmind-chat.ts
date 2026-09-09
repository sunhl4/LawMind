// TODO(renderer-fetch-proxy): migrate remaining fetch calls to fetchApi / api-client-proxy.
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import type { GateDecision, TaskExecutionState } from "../../../../src/lawmind/platform/contracts.ts";
import type { LawMindRequiresAction } from "../../../../src/lawmind/platform/requires-action.ts";
import { parseRequiresActionsFromResponse } from "./lawmind-requires-action";
import { isAwaitingClarification } from "../../../../src/lawmind/platform/execution-state.ts";
import {
  chatErrorUserText,
  fetchWithLoopbackAuthRetry,
  readJsonFromResponse,
  type ApiErrorJson,
} from "./api-client";
import { apiAuthHeaders } from "./lawmind-api-auth.ts";
import { readIncludeTurnDiagnostics } from "./lawmind-chat-diagnostics-pref";
import type { ChatLiveTrace } from "./lawmind-chat-trace-types.js";
import type { ChatActivityBlock } from "./lawmind-chat-activity.js";

/** Mirrors `GET /api/chat` `runtimeHints` when Firm/Private or `includeTurnDiagnostics`. */
export type ChatRuntimeHints = {
  lawmindRouterMode: string;
  lawmindReasoningMode: string;
  toolCallsExecuted: number;
};

/**
 * 主输入框：Enter 发送，Shift+Enter 换行。IME 正在组字时不发送。
 */
export function handleEnterSendShiftNewline(
  e: ReactKeyboardEvent<HTMLTextAreaElement>,
  onSend: () => void | Promise<void>,
): void {
  if (e.key !== "Enter") {
    return;
  }
  if (e.shiftKey) {
    return;
  }
  const ne = e.nativeEvent;
  if (ne.isComposing) {
    return;
  }
  if ("keyCode" in ne && (ne).keyCode === 229) {
    return;
  }
  e.preventDefault();
  void onSend();
}

export type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  status?: string;
  clarificationQuestions?: ClarificationQuestion[];
  memorySources?: MemorySourceLayer[];
  toolCallSequence?: string[];
  /** Present on assistant messages when the server included turn diagnostics. */
  runtimeHints?: ChatRuntimeHints;
  executionState?: TaskExecutionState;
  gateDecisions?: GateDecision[];
  /** Cursor 式活动流：模型原文 + 工具步骤交错 */
  activity?: ChatActivityBlock[];
  activityActive?: boolean;
  /** Cursor 式执行轨迹（流式或后台任务轮询） — 兼容旧数据 */
  liveTrace?: ChatLiveTrace;
  /** 模型/API 不可用时的简短失败说明（不展示 Thought 轨迹） */
  failureKind?: "model";
  /** 律师待处理动作（澄清、工具批准等） */
  requiresAction?: LawMindRequiresAction[];
  /** 法条/类案检索未命中权威源时的缺源提示（对话内醒目展示） */
  authorityGapNotice?: string;
  /** 命中开源演示 sample / 标记为 demo 的 CORPUS 时的语料水印 */
  demoCorpusNotice?: string;
  /** Recovery CTAs from research_evidence_gate / demo_corpus_gate (SSE tool_call_end). */
  researchNextActions?: string[];
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

export function hasChatDiagnostics(message: ChatMsg): boolean {
  return (
    (message.memorySources?.length ?? 0) > 0 ||
    (message.toolCallSequence?.length ?? 0) > 0 ||
    message.runtimeHints != null
  );
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
  if (
    isAwaitingClarification(last.executionState, last.gateDecisions) ||
    last.status === "awaiting_clarification"
  ) {
    return { pending: true, count, assistantMessageIndex: messages.length - 1 };
  }
  if (count > 0) {
    return { pending: true, count, assistantMessageIndex: messages.length - 1 };
  }
  return { pending: false, count: 0, assistantMessageIndex: -1 };
}

import type { ComposeContextPin } from "../../../../src/lawmind/platform/compose-context-pin.ts";

type SendChatTurnArgs = {
  apiBase: string;
  modelId?: string;
  message: string;
  sessionId?: string;
  assistantId: string;
  allowWebSearch: boolean;
  permissionMode?: "standard" | "strict" | "readonly" | "research";
  matterId?: string | null;
  projectDir?: string | null;
  /** Structured compose `@` pins (files + truth sources). */
  contextPins?: ComposeContextPin[];
  /** 关联任务/草稿时的 taskId */
  linkedTaskId?: string | null;
  /** 输入框原文（无文件/学习前缀），用于自动会话标题 */
  sessionTitleHint?: string;
  /** 中止后 `fetch` 会以 `AbortError` 拒绝 */
  signal?: AbortSignal;
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
  executionState?: TaskExecutionState;
  gateDecisions?: GateDecision[];
  clarificationQuestions?: ClarificationQuestion[];
  memorySources?: MemorySourceLayer[];
  toolCallSequence?: string[];
  toolCalls?: number;
  runtimeHints?: unknown;
};

/** `fetch` 被 `AbortController.abort()` 取消时抛出的错误 */
export function isFetchAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") {
    return true;
  }
  return e instanceof Error && e.name === "AbortError";
}

/** 若当前助手最后一条用户消息正文与 `expectedUserText` 一致则移除（用于中止发送后恢复可编辑） */
export function dropTrailingUserMessageIfText(
  messagesByAssistant: Record<string, ChatMsg[]>,
  assistantId: string,
  expectedUserText: string,
): Record<string, ChatMsg[]> {
  const list = messagesByAssistant[assistantId] ?? [];
  const last = list[list.length - 1];
  if (!last || last.role !== "user" || last.text !== expectedUserText) {
    return messagesByAssistant;
  }
  return {
    ...messagesByAssistant,
    [assistantId]: list.slice(0, -1),
  };
}

export type StreamingChatCallbacks = {
  onRoundStart?: (roundIndex: number) => void;
  onToolCallStart?: (info: {
    toolCallId: string;
    toolName: string;
    roundIndex: number;
    args?: Record<string, unknown>;
  }) => void;
  onToolCallEnd?: (info: {
    toolCallId: string;
    toolName: string;
    roundIndex: number;
    ok: boolean;
    error?: string;
    authorityGap?: boolean;
    demoCorpus?: boolean;
    nextActions?: string[];
    resultPreview?: string;
  }) => void;
  onToolProgress?: (info: {
    toolCallId: string;
    toolName: string;
    roundIndex: number;
    label: string;
  }) => void;
  onDelta?: (text: string) => void;
  onTokenBudget?: (info: {
    used: number;
    effectiveLimit: number;
    level: "ok" | "warn" | "compact";
  }) => void;
  onToolBudget?: (info: {
    used: number;
    maxToolCalls: number;
    level: "warn";
  }) => void;
  onCompactBoundary?: (info: {
    sessionSummaryPath?: string;
    droppedMessageCount?: number;
    overflowPrune?: boolean;
  }) => void;
};

/**
 * Streaming variant of `sendChatTurn`. Uses SSE via `fetch` reader (EventSource
 * does not support POST). Falls back to non-streaming `sendChatTurn` if the
 * server response is not `text/event-stream`.
 */

function lawmindCoerceToolField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export async function sendChatTurnStream(
  args: SendChatTurnArgs,
  callbacks: StreamingChatCallbacks = {},
): Promise<{ sessionId?: string; assistantMessage: ChatMsg }> {
  const includeTurnDiagnostics = readIncludeTurnDiagnostics();
  const { response } = await fetchWithLoopbackAuthRetry(args.apiBase, (base) =>
    fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...apiAuthHeaders(),
      },
      signal: args.signal,
      body: JSON.stringify({
        message: args.message,
        ...(args.modelId ? { modelId: args.modelId } : {}),
        sessionId: args.sessionId,
        assistantId: args.assistantId,
        allowWebSearch: args.allowWebSearch,
        ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
        ...(args.matterId ? { matterId: args.matterId } : {}),
        ...(args.projectDir ? { projectDir: args.projectDir } : {}),
        ...(args.contextPins && args.contextPins.length > 0 ? { contextPins: args.contextPins } : {}),
        ...(args.linkedTaskId ? { linkedTaskId: args.linkedTaskId } : {}),
        ...(args.sessionTitleHint?.trim() ? { sessionTitleHint: args.sessionTitleHint.trim() } : {}),
        ...(includeTurnDiagnostics ? { includeTurnDiagnostics: true } : {}),
      }),
    }),
  );
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("text/event-stream") || !response.body) {
    const body = await readJsonFromResponse<ChatResponse>(response);
    if (args.signal?.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }
    if (!response.ok || body.ok === false) {
      throw new Error(chatErrorUserText(response.status, body as ApiErrorJson));
    }
    return buildChatTurnResult(body);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let payloadBody: ChatResponse | null = null;
  const streamErrorCell: { current: { status: number; body: ApiErrorJson } | null } = { current: null };
  let finishedDone = false;

  const handleEvent = (name: string, data: string): void => {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      switch (name) {
        case "round_start": {
          const roundIndex =
            typeof parsed.roundIndex === "number" ? parsed.roundIndex : 0;
          callbacks.onRoundStart?.(roundIndex);
          break;
        }
        case "tool_call_start": {
          callbacks.onToolCallStart?.({
            toolCallId: lawmindCoerceToolField(parsed.toolCallId),
            toolName: lawmindCoerceToolField(parsed.toolName),
            roundIndex: typeof parsed.roundIndex === "number" ? parsed.roundIndex : 0,
            args:
              parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
                ? (parsed.args as Record<string, unknown>)
                : undefined,
          });
          break;
        }
        case "tool_call_end": {
          const nextActions = Array.isArray(parsed.nextActions)
            ? parsed.nextActions.filter((x): x is string => typeof x === "string")
            : undefined;
          callbacks.onToolCallEnd?.({
            toolCallId: lawmindCoerceToolField(parsed.toolCallId),
            toolName: lawmindCoerceToolField(parsed.toolName),
            roundIndex: typeof parsed.roundIndex === "number" ? parsed.roundIndex : 0,
            ok: parsed.ok === true,
            error: typeof parsed.error === "string" ? parsed.error : undefined,
            authorityGap: parsed.authorityGap === true,
            demoCorpus: parsed.demoCorpus === true,
            ...(nextActions && nextActions.length > 0 ? { nextActions } : {}),
            ...(typeof parsed.resultPreview === "string" && parsed.resultPreview.trim()
              ? { resultPreview: parsed.resultPreview.trim() }
              : {}),
          });
          break;
        }
        case "tool_progress": {
          callbacks.onToolProgress?.({
            toolCallId: lawmindCoerceToolField(parsed.toolCallId),
            toolName: lawmindCoerceToolField(parsed.toolName),
            roundIndex: typeof parsed.roundIndex === "number" ? parsed.roundIndex : 0,
            label: typeof parsed.label === "string" ? parsed.label : "",
          });
          break;
        }
        case "delta": {
          if (typeof parsed.text === "string") {
            callbacks.onDelta?.(parsed.text);
          }
          break;
        }
        case "token_budget": {
          if (
            typeof parsed.used === "number" &&
            typeof parsed.effectiveLimit === "number" &&
            typeof parsed.level === "string"
          ) {
            callbacks.onTokenBudget?.({
              used: parsed.used,
              effectiveLimit: parsed.effectiveLimit,
              level: parsed.level as "ok" | "warn" | "compact",
            });
          }
          break;
        }
        case "tool_budget": {
          if (
            typeof parsed.used === "number" &&
            typeof parsed.maxToolCalls === "number" &&
            parsed.level === "warn"
          ) {
            callbacks.onToolBudget?.({
              used: parsed.used,
              maxToolCalls: parsed.maxToolCalls,
              level: "warn",
            });
          }
          break;
        }
        case "compact_boundary": {
          callbacks.onCompactBoundary?.({
            sessionSummaryPath:
              typeof parsed.sessionSummaryPath === "string"
                ? parsed.sessionSummaryPath
                : undefined,
            droppedMessageCount:
              typeof parsed.droppedMessageCount === "number"
                ? parsed.droppedMessageCount
                : undefined,
          });
          break;
        }
        case "overflow_prune": {
          const pruned =
            typeof parsed.prunedCount === "number" ? parsed.prunedCount : undefined;
          callbacks.onCompactBoundary?.({
            droppedMessageCount: pruned,
            overflowPrune: true,
          });
          break;
        }
        case "final":
        case "final_reply": {
          break;
        }
        case "payload": {
          payloadBody = parsed as ChatResponse;
          break;
        }
        case "error": {
          streamErrorCell.current = {
            status: typeof parsed.status === "number" ? parsed.status : 500,
            body: parsed as ApiErrorJson,
          };
          break;
        }
        case "done": {
          finishedDone = true;
          break;
        }
        default:
          break;
      }
    } catch {
      /* skip malformed event */
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^ /, ""));
          }
        }
        if (dataLines.length > 0) {
          handleEvent(eventName, dataLines.join("\n"));
        }
      }
      if (finishedDone) {
        break;
      }
    }
    if (done) {
      break;
    }
  }

  if (args.signal?.aborted) {
    throw new DOMException("The user aborted a request.", "AbortError");
  }
  const streamErr = streamErrorCell.current;
  if (streamErr) {
    throw new Error(chatErrorUserText(streamErr.status, streamErr.body));
  }
  if (!payloadBody) {
    throw new Error("流式响应未返回最终内容。请重试或检查网络。");
  }
  return buildChatTurnResult(payloadBody);
}

function buildChatTurnResult(body: ChatResponse): {
  sessionId?: string;
  assistantMessage: ChatMsg;
} {
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
  const requiresAction = parseRequiresActionsFromResponse(
    (body as { requiresAction?: unknown }).requiresAction,
  );
  return {
    sessionId: body.sessionId,
    assistantMessage: {
      role: "assistant",
      text:
        body.reply?.trim() ||
        (body.status === "awaiting_approval"
          ? "有操作等待您的确认，请打开待我拍板或继续对话。"
          : body.toolCalls && body.toolCalls > 0
            ? "本轮已执行工具但未返回文字说明，请查看上方工具状态或改稿页草稿。"
            : "本轮未返回可见回复，请重试或检查模型配置。"),
      ...(typeof body.status === "string" && body.status.trim() ? { status: body.status } : {}),
      ...(body.executionState ? { executionState: body.executionState } : {}),
      ...(Array.isArray(body.gateDecisions) ? { gateDecisions: body.gateDecisions } : {}),
      ...(clarificationQuestions.length > 0 ? { clarificationQuestions } : {}),
      ...(memorySources && memorySources.length > 0 ? { memorySources } : {}),
      ...(toolCallSequence.length > 0 ? { toolCallSequence } : {}),
      ...(runtimeHints ? { runtimeHints } : {}),
      ...(requiresAction.length > 0 ? { requiresAction } : {}),
    },
  };
}

export async function sendChatTurn(args: SendChatTurnArgs): Promise<{
  sessionId?: string;
  assistantMessage: ChatMsg;
}> {
  const includeTurnDiagnostics = readIncludeTurnDiagnostics();
  const { response } = await fetchWithLoopbackAuthRetry(args.apiBase, (base) =>
    fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...apiAuthHeaders() },
      signal: args.signal,
      body: JSON.stringify({
        message: args.message,
        ...(args.modelId ? { modelId: args.modelId } : {}),
        sessionId: args.sessionId,
        assistantId: args.assistantId,
        allowWebSearch: args.allowWebSearch,
        ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
        ...(args.matterId ? { matterId: args.matterId } : {}),
        ...(args.projectDir ? { projectDir: args.projectDir } : {}),
        ...(args.contextPins && args.contextPins.length > 0 ? { contextPins: args.contextPins } : {}),
        ...(args.linkedTaskId ? { linkedTaskId: args.linkedTaskId } : {}),
        ...(args.sessionTitleHint?.trim() ? { sessionTitleHint: args.sessionTitleHint.trim() } : {}),
        ...(includeTurnDiagnostics ? { includeTurnDiagnostics: true } : {}),
      }),
    }),
  );
  const body = await readJsonFromResponse<ChatResponse>(response);
  if (args.signal?.aborted) {
    throw new DOMException("The user aborted a request.", "AbortError");
  }
  if (!response.ok || body.ok === false) {
    throw new Error(chatErrorUserText(response.status, body as ApiErrorJson));
  }
  return buildChatTurnResult(body);
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
