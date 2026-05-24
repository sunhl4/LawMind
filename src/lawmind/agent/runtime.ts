/**
 * LawMind Agent Runtime — 自主推理循环
 *
 * 核心 loop：
 *   1. 收到用户指令
 *   2. 构建 system prompt（包含律师 profile、案件上下文、可用工具）
 *   3. 发送给 LLM，附带 function calling tools
 *   4. LLM 决定调用工具 → 执行工具 → 把结果返还给 LLM
 *   5. 重复 3-4 直到 LLM 给出最终回答
 *   6. 保存 session，记录审计
 *
 * 与 reference agent stack 的差异：
 *   - reference agent stack 基于 pi-agent-core / pi-coding-agent
 *   - LawMind 直接使用 OpenAI compatible API + 自建工具调度
 *   - 但设计理念相同：LLM 驱动的自主推理 + tool use
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  formatCurrentAssistantOrgLine,
  formatTeamOrgOverviewForPrompt,
} from "../assistants/org-prompt.js";
import { buildPeerAssistantsForPrompt } from "../assistants/peer-list.js";
import { readAssistantProfileMarkdown } from "../assistants/profile-md.js";
import {
  getAssistantById,
  loadAssistantProfiles,
  resolveLawMindRoot,
} from "../assistants/store.js";
import { emit } from "../audit/index.js";
import { getRoleById } from "../core/role.js";
import { loadMemoryContext, type MemoryContext } from "../memory/index.js";
import { findRelevantMemoriesForTurn } from "../memory/relevant-recall.js";
import { maybeAutoAppendSessionSummary } from "../memory/session-summary.js";
import {
  mergeUsageSnapshots,
  recordModelUsage,
  usageFromProvider,
  type ModelUsageSnapshot,
} from "../models/model-usage.js";
import { emitPlatformGateSnapshot } from "../platform/audit-gate.js";
import type { GateDecision } from "../platform/contracts.js";
import { executionStateFromTurn } from "../platform/execution-state.js";
import { buildRequiresActionsFromTurn } from "../platform/requires-action.js";
import {
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
} from "../policy/workspace-policy.js";
import { partitionToolCalls, type ToolCallRef } from "../runtime/tool-concurrency.js";
import {
  buildDefaultToolPipeline,
  composeToolPipeline,
  type ToolCallContext,
} from "../runtime/tool-pipeline.js";
import { persistAgentInstructionTask } from "../tasks/index.js";
import type { ClarificationQuestion } from "../types.js";
import { getAssistantPreset } from "./assistant-presets.js";
import { autoCompactSessionHistory } from "./compact.js";
import { estimateTokenBudget } from "./context-budget.js";
import { resolveToolSandboxEnabled } from "./dangerous-tool-policy.js";
import {
  buildDeliverablePipelineSystemNote,
  formatDeliverableWorkflowReply,
  shouldAutoRunDeliverableWorkflow,
} from "./deliverable-pipeline.js";
import {
  applyLiveTurnEvent,
  attachPersistedLiveTraceToLastAssistant,
  beginLiveTurnProgress,
  finishLiveTurnProgress,
} from "./live-turn-progress.js";
import { tryBuildModelConnectivityCheckReply } from "./model-connectivity-check.js";
import { tryBuildModelIdentityReply } from "./model-identity-reply.js";
import { filterToolsForPermissionMode, type AgentPermissionMode } from "./permission-mode.js";
import {
  appendTurn,
  createSession,
  loadSession,
  maybeUpdateSessionTitleFromInstruction,
  saveSession,
  toModelMessages,
} from "./session.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { executeWorkflow } from "./tools/engine-tools.js";
import type { ToolRegistry } from "./tools/registry.js";
import type {
  AgentConfig,
  AgentContext,
  AgentMessage,
  AgentModelConfig,
  AgentTurn,
} from "./types.js";

const DEFAULT_MAX_TOOL_CALLS = 15;
const DEFAULT_MAX_HISTORY_MESSAGES = 50;
/** 模型单次调用超时（起草等任务可能较慢，60s 减少 aborted） */
const DEFAULT_MODEL_TIMEOUT_MS = 60000;
const DEFAULT_MODEL_MAX_RETRIES = 2;
/** Used only when `AgentConfig.toolExecutionTimeoutMs` is unset (CLI/desktop should set via env). */
const DEFAULT_TOOL_TIMEOUT_MS = 30000;

function extractClarificationQuestions(result: {
  ok: boolean;
  data?: unknown;
}): ClarificationQuestion[] {
  if (!result.ok || !result.data || typeof result.data !== "object") {
    return [];
  }
  const data = result.data as {
    clarificationQuestions?: unknown;
    deliveryReadiness?: unknown;
  };
  if (data.deliveryReadiness !== "draft_with_placeholders") {
    return [];
  }
  if (!Array.isArray(data.clarificationQuestions)) {
    return [];
  }
  return data.clarificationQuestions.filter(
    (item): item is ClarificationQuestion =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { key?: unknown }).key === "string" &&
      typeof (item as { question?: unknown }).question === "string",
  );
}

function extractToolErrorMessage(result: { ok: boolean; error?: string }): string {
  if (typeof result.error === "string" && result.error.length > 0) {
    return result.error;
  }
  return "tool_failed";
}

function buildClarificationReply(
  assistantReply: string,
  questions: ClarificationQuestion[],
  intro = "已生成可继续编辑的正式草稿，但要完成最终交付，还需要你补充以下关键信息：",
): string {
  const body = questions.map((item, index) => `${index + 1}. ${item.question}`).join("\n");
  const prefix = assistantReply.trim();
  return prefix ? `${prefix}\n\n${intro}\n${body}` : `${intro}\n${body}`;
}

/** When the model ends with tool-only hops and no final prose, synthesize a lawyer-facing summary. */
function buildTurnReplyFallback(turn: AgentTurn): string {
  const lines: string[] = [];
  for (const msg of turn.messages) {
    if (msg.role !== "tool" || !msg.toolCallResponses?.length) {
      continue;
    }
    for (const tr of msg.toolCallResponses) {
      const name = tr.name;
      if (tr.result.ok) {
        const data = tr.result.data;
        if (data && typeof data === "object" && data !== null) {
          const rec = data as Record<string, unknown>;
          if (typeof rec.outputPath === "string" && rec.outputPath.trim()) {
            lines.push(`已生成交付文件：${rec.outputPath.trim()}`);
            continue;
          }
          if (typeof rec.message === "string" && rec.message.trim()) {
            lines.push(rec.message.trim());
            continue;
          }
          if (typeof rec.taskId === "string" && rec.taskId.trim()) {
            lines.push(`草稿任务 ID：${rec.taskId.trim()}（可在审核台打开）`);
            continue;
          }
        }
        lines.push(`工具「${name}」已执行完成。`);
      } else {
        const err = extractToolErrorMessage(tr.result).slice(0, 400);
        lines.push(`工具「${name}」未完成：${err}`);
      }
    }
  }
  if (lines.length > 0) {
    return [
      "本轮模型未返回附加说明，以下为工具执行结果摘要：",
      ...lines.slice(-8),
      turn.status === "awaiting_approval"
        ? "\n有步骤等待您确认；请在审核台或通过对话继续。"
        : "\n如需 Word，请在审核台对已通过草稿点击「渲染交付物」或「仍要导出 Word」。",
    ].join("\n");
  }
  if (turn.status === "awaiting_approval") {
    return "有操作等待您的确认。请查看工具结果，或在审核台继续签批与导出。";
  }
  return "本轮未生成文字说明。若您要求完善并导出 Word，请到审核台打开对应草稿：已通过签批的可点「仍要导出 Word」；或在对话中说明 task_id 让我调用 render_document。";
}

type ChatCompletionMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type ChatCompletionResponse = {
  choices: Array<{
    message: ChatCompletionMessage;
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

function formatModelFetchError(err: unknown, config: AgentModelConfig, timeoutMs: number): Error {
  if (err instanceof Error && err.name === "AbortError") {
    return new Error(
      `Model request timed out after ${timeoutMs}ms. Check network or increase LAWMIND_AGENT_TIMEOUT_MS in .env.lawmind.`,
    );
  }
  const cause =
    err instanceof Error && "cause" in err && err.cause instanceof Error ? err.cause.message : "";
  const msg = err instanceof Error ? err.message : String(err);
  const combined = `${msg} ${cause}`.trim();
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|certificate|TLS/i.test(combined)) {
    return new Error(
      `Model network error: ${combined}. Verify baseUrl (${config.baseUrl}), DNS, proxy, and firewall.`,
    );
  }
  return err instanceof Error ? err : new Error(combined || "Model call failed");
}

/** Streaming chunk shape (OpenAI SSE `data: {...}` lines). */
type ChatCompletionStreamChunk = {
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export type CallModelOptions = {
  /** Request streaming SSE; deltas are pushed via `onDelta` and finally assembled to ChatCompletionResponse. */
  stream?: boolean;
  /** Per-chunk content delta (final round only). */
  onDelta?: (chunk: string) => void;
};

/** Accumulate streaming chunks into a final `ChatCompletionResponse` shape. */
export function aggregateStreamChunks(chunks: ChatCompletionStreamChunk[]): ChatCompletionResponse {
  let role = "assistant";
  let content = "";
  let finishReason = "stop";
  type ToolCallAcc = {
    id: string;
    name: string;
    args: string;
  };
  const toolCalls = new Map<number, ToolCallAcc>();
  let usage: ChatCompletionResponse["usage"];

  for (const chunk of chunks) {
    const choice = chunk.choices?.[0];
    if (!choice) {
      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens ?? 0,
          completion_tokens: chunk.usage.completion_tokens ?? 0,
          total_tokens: chunk.usage.total_tokens ?? 0,
        };
      }
      continue;
    }
    const delta = choice.delta ?? {};
    if (delta.role) {
      role = delta.role;
    }
    if (typeof delta.content === "string") {
      content += delta.content;
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const acc = toolCalls.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) {
          acc.id = tc.id;
        }
        if (tc.function?.name) {
          acc.name = tc.function.name;
        }
        if (typeof tc.function?.arguments === "string") {
          acc.args += tc.function.arguments;
        }
        toolCalls.set(idx, acc);
      }
    }
    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
    if (chunk.usage) {
      usage = {
        prompt_tokens: chunk.usage.prompt_tokens ?? 0,
        completion_tokens: chunk.usage.completion_tokens ?? 0,
        total_tokens: chunk.usage.total_tokens ?? 0,
      };
    }
  }

  const message: ChatCompletionMessage = {
    role: role as "assistant",
    content: content || null,
  };
  if (toolCalls.size > 0) {
    message.tool_calls = [...toolCalls.entries()]
      .toSorted(([a], [b]) => a - b)
      .map(([, acc]) => ({
        id: acc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        type: "function" as const,
        function: { name: acc.name, arguments: acc.args || "{}" },
      }));
  }

  return {
    choices: [{ message, finish_reason: finishReason }],
    usage,
  };
}

/** Parse one SSE buffer (may contain multiple `\n\n`-separated events). */
export function parseSseChunks(buffer: string): {
  events: ChatCompletionStreamChunk[];
  rest: string;
  done: boolean;
} {
  const events: ChatCompletionStreamChunk[] = [];
  let done = false;
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) {
      continue;
    }
    const payload = dataLines.join("\n");
    if (payload === "[DONE]") {
      done = true;
      continue;
    }
    try {
      events.push(JSON.parse(payload) as ChatCompletionStreamChunk);
    } catch {
      /* skip malformed chunk */
    }
  }
  return { events, rest, done };
}

/**
 * 调用 OpenAI-compatible chat completions API
 */
async function callModelOnce(
  config: AgentModelConfig,
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>,
  tools: unknown[],
  opts: CallModelOptions = {},
): Promise<ChatCompletionResponse> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature ?? 0.3,
  };

  if (config.maxTokens) {
    body.max_tokens = config.maxTokens;
  }

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const wantStream = opts.stream === true;
  if (wantStream) {
    body.stream = true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...(wantStream ? { Accept: "text/event-stream" } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw formatModelFetchError(err, config, timeoutMs);
  }

  if (!response.ok) {
    clearTimeout(timer);
    const text = await response.text();
    const hint =
      response.status === 404
        ? " 常见原因：模型名错误（如 qwen-max 需与 DashScope 一致）或 baseUrl 路径错误。请检查 .env.lawmind 中 LAWMIND_QWEN_MODEL / LAWMIND_AGENT_MODEL。"
        : "";
    throw new Error(`Model API error ${response.status}: ${text.slice(0, 300)}${hint}`);
  }

  if (!wantStream || !response.body) {
    clearTimeout(timer);
    return (await response.json()) as ChatCompletionResponse;
  }

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: ChatCompletionStreamChunk[] = [];
    let buffer = "";
    let suppressDeltas = false;
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunks(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) {
          chunks.push(event);
          const delta = event.choices?.[0]?.delta;
          if (delta?.tool_calls && delta.tool_calls.length > 0) {
            suppressDeltas = true;
          }
          const deltaContent = delta?.content;
          if (
            !suppressDeltas &&
            typeof deltaContent === "string" &&
            deltaContent.length > 0 &&
            opts.onDelta
          ) {
            try {
              opts.onDelta(deltaContent);
            } catch {
              /* ignore consumer errors */
            }
          }
        }
        if (parsed.done) {
          break;
        }
      }
      if (done) {
        break;
      }
    }
    return aggregateStreamChunks(chunks);
  } catch (err) {
    throw formatModelFetchError(err, config, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

async function callModelWithRetry(
  config: AgentModelConfig,
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>,
  tools: unknown[],
  opts: CallModelOptions = {},
): Promise<ChatCompletionResponse> {
  const maxRetries = config.maxRetries ?? DEFAULT_MODEL_MAX_RETRIES;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await callModelOnce(config, messages, tools, opts);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= maxRetries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error("Model call failed");
}

/**
 * Streaming progress event for a single `runTurn` invocation.
 *
 * - `round_start`: every model round begins (`roundIndex` starts at 1).
 * - `tool_call_start` / `tool_call_end`: each tool invocation in intermediate rounds.
 * - `delta`: incremental model text (streamed or full segment after non-stream round).
 * - `clarification`: clarification questions surfaced.
 * - `final`: end-of-turn final reply + status.
 */
export type RunTurnEvent =
  | { type: "round_start"; roundIndex: number }
  | {
      type: "tool_call_start";
      roundIndex: number;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_call_end";
      roundIndex: number;
      toolCallId: string;
      toolName: string;
      ok: boolean;
      error?: string;
    }
  | {
      type: "tool_progress";
      roundIndex: number;
      toolCallId: string;
      toolName: string;
      label: string;
    }
  | { type: "delta"; roundIndex: number; text: string }
  | {
      type: "clarification";
      questions: ClarificationQuestion[];
    }
  | {
      type: "final";
      status: AgentTurn["status"];
      reply: string;
    }
  | {
      type: "token_budget";
      used: number;
      effectiveLimit: number;
      level: "ok" | "warn" | "compact";
    }
  | {
      type: "compact_boundary";
      sessionSummaryPath?: string;
      droppedMessageCount?: number;
    }
  | {
      type: "requires_action";
      payload: import("../platform/requires-action.js").LawMindRequiresAction;
    };

/**
 * Agent 的一次完整 turn（从用户指令到最终回答）
 */
function collectRecentToolNamesFromSession(session: AgentSession): string[] {
  const names = new Set<string>();
  for (let i = session.turns.length - 1; i >= 0 && names.size < 12; i--) {
    const turn = session.turns[i];
    if (!turn) {
      continue;
    }
    for (const msg of turn.messages) {
      for (const tc of msg.toolCalls ?? []) {
        names.add(tc.name);
      }
    }
  }
  return [...names];
}

export async function runTurn(opts: {
  config: AgentConfig;
  registry: ToolRegistry;
  sessionId?: string;
  instruction: string;
  /** 用于会话自动标题：输入框原文（不含前缀），优先于 instruction 取前几个字 */
  sessionTitleHint?: string;
  matterId?: string;
  /** 桌面工作台关联草稿 taskId；注入 AgentContext 供工具隐式默认 */
  linkedTaskId?: string;
  /** 桌面端项目目录；与会话同轮生效，供工具检索项目内文件 */
  projectDir?: string;
  /** 案件工作台团队会议室：写入 system prompt 行为约束 */
  teamMeetingMode?: boolean;
  /** Optional progress observer. Final-round content is streamed via `delta`. */
  onEvent?: (event: RunTurnEvent) => void;
  /** When set, progress is also written for GET /api/sessions/:id/live-turn polling. */
  liveProgressSessionId?: string;
  /** resumeTurn：自动为同名工具注入 __approved */
  preApproveToolName?: string;
  preApproveToolArgs?: Record<string, unknown>;
  permissionMode?: AgentPermissionMode;
}): Promise<{ turn: AgentTurn; reply: string; sessionId: string; memoryContext: MemoryContext }> {
  const { config, registry, instruction, matterId, sessionTitleHint } = opts;
  const linkedTaskIdForCtx =
    typeof opts.linkedTaskId === "string" && opts.linkedTaskId.trim()
      ? opts.linkedTaskId.trim()
      : undefined;
  const projectDirResolved = (opts.projectDir ?? config.projectDir)?.trim() || undefined;
  const maxToolCalls = config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const maxHistory = config.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
  const toolTimeoutMs = config.toolExecutionTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const allowDangerousToolsWithoutApproval = config.allowDangerousToolsWithoutApproval ?? false;
  const permissionMode: AgentPermissionMode =
    opts.permissionMode ?? config.permissionMode ?? "standard";
  const strictDangerousToolApproval =
    permissionMode === "strict" || config.strictDangerousToolApproval === true;
  const actorId = config.actorId ?? "system";

  // 1. 加载或创建 session
  let session = opts.sessionId ? loadSession(config.workspaceDir, opts.sessionId) : undefined;
  if (!session) {
    session = createSession({
      workspaceDir: config.workspaceDir,
      matterId,
      actorId,
      assistantId: config.assistantId,
    });
  } else {
    if (config.assistantId && session.assistantId && session.assistantId !== config.assistantId) {
      throw new Error("session_assistant_mismatch");
    }
    if (!session.assistantId && config.assistantId) {
      session.assistantId = config.assistantId;
    }
  }

  if (matterId && !session.matterId) {
    session.matterId = matterId;
  }

  // 新用户 instruction 视为对上一轮待澄清的回复：清除磁盘上的 pending，本轮内由工具结果重新设置 blocking。
  if (session.pendingClarificationKeys?.length) {
    delete session.pendingClarificationKeys;
  }

  const turnId = randomUUID();
  const startedAt = new Date().toISOString();

  const resolvedAssistantId = config.assistantId ?? session.assistantId;

  const ctx: AgentContext = {
    workspaceDir: config.workspaceDir,
    sessionId: session.sessionId,
    matterId: session.matterId,
    actorId,
    assistantId: resolvedAssistantId,
    projectDir: projectDirResolved,
    linkedTaskId: linkedTaskIdForCtx,
    allowWebSearch: config.allowWebSearch === true,
    permissionMode,
    collaborationEnabled: config.enableCollaboration === true,
    envFile: config.envFile,
    clarificationBlockingHeavyTools: false,
    strictDangerousToolApproval,
    preApproveToolName: opts.preApproveToolName?.trim() || undefined,
    preApproveToolArgs: opts.preApproveToolArgs,
  };

  // 2. 构建 system prompt
  const memory = await loadMemoryContext(config.workspaceDir, { matterId: session.matterId });

  let assistantProfileMarkdown = "";
  let presetForTools: ReturnType<typeof getAssistantPreset> | undefined;
  let roleForTools: ReturnType<typeof getRoleById> | undefined;
  if (resolvedAssistantId) {
    try {
      const lawMindRoot = resolveLawMindRoot(config.workspaceDir);
      assistantProfileMarkdown = readAssistantProfileMarkdown(lawMindRoot, resolvedAssistantId);
      const prof = getAssistantById(lawMindRoot, resolvedAssistantId);
      presetForTools = getAssistantPreset(prof?.presetKey);
      // W7：优先用 Role；过渡期回退到 preset。
      roleForTools = getRoleById(prof?.roleId ?? prof?.presetKey);
    } catch {
      assistantProfileMarkdown = "";
    }
  }

  let peerAssistants: Array<{ id: string; displayName: string; roleTitle: string }> | undefined;
  let peerAssistantsBusy: Array<{ id: string; displayName: string; roleTitle: string }> | undefined;
  let teamOrgOverview: string | undefined;
  let assistantOrgLine: string | undefined;
  const lawMindRoot = resolveLawMindRoot(config.workspaceDir, config.envFile);
  try {
    const allProfiles = loadAssistantProfiles(lawMindRoot);
    teamOrgOverview = formatTeamOrgOverviewForPrompt(allProfiles);
    if (resolvedAssistantId) {
      const me = getAssistantById(lawMindRoot, resolvedAssistantId);
      assistantOrgLine = formatCurrentAssistantOrgLine(me, allProfiles);
    }
  } catch (err) {
    console.error("[lawmind] team org overview failed:", err);
    teamOrgOverview = undefined;
    assistantOrgLine = undefined;
  }
  if (config.enableCollaboration) {
    try {
      const peers = buildPeerAssistantsForPrompt({
        lawMindRoot,
        workspaceDir: config.workspaceDir,
        currentAssistantId: resolvedAssistantId,
      });
      peerAssistants = peers.available;
      peerAssistantsBusy = peers.busy;
    } catch (err) {
      console.error("[lawmind] peer assistants load failed:", err);
      peerAssistants = [];
      peerAssistantsBusy = [];
    }
  }

  const workspacePolicy = readWorkspacePolicyFile(config.workspaceDir);
  const toolSandboxEnabled = resolveToolSandboxEnabled(config.workspaceDir);
  const mandatoryRules = resolveAgentMandatoryRulesForPrompt(config.workspaceDir, workspacePolicy);

  const deliverablePipelineNote = buildDeliverablePipelineSystemNote(instruction);
  const systemPrompt = buildSystemPrompt({
    lawyerProfile: memory.profile,
    assistantProfileMarkdown: assistantProfileMarkdown || undefined,
    clientProfile: memory.clientProfile || undefined,
    matterContext: memory.caseMemory,
    todayLog: memory.todayLog,
    availableTools: registry.listDefinitions(),
    matterId: session.matterId,
    roleTitle: config.roleTitle,
    roleIntroduction: config.roleIntroduction,
    roleDirective: config.roleDirective,
    roleRiskCeiling: presetForTools?.riskCeiling,
    roleAcceptanceChecklist: presetForTools?.acceptanceChecklist,
    allowWebSearch: config.allowWebSearch === true,
    collaborationEnabled: config.enableCollaboration === true,
    peerAssistants,
    peerAssistantsBusy,
    projectDirectoryHint: projectDirResolved,
    linkedTaskId: linkedTaskIdForCtx,
    agentMandatoryRules: mandatoryRules.active ? mandatoryRules.text : undefined,
    assistantOrgLine,
    teamOrgOverview,
    teamMeetingMode: opts.teamMeetingMode === true,
    runtimeModel: config.runtimeModel,
    deliverablePipelineNote,
  });

  let systemPromptFinal = systemPrompt;
  const surfaced = new Set(session.alreadySurfacedMemoryPaths ?? []);
  const recentToolNames = collectRecentToolNamesFromSession(session);
  const recalled = await findRelevantMemoriesForTurn({
    workspaceDir: config.workspaceDir,
    matterId: session.matterId,
    query: instruction,
    alreadySurfaced: surfaced,
    recentToolNames,
    policy: workspacePolicy,
  });
  if (recalled.length > 0) {
    const blocks: string[] = ["\n\n## 相关记忆（本轮召回）\n"];
    for (const hit of recalled) {
      try {
        const full = path.join(config.workspaceDir, hit.relativePath);
        const text = fs.readFileSync(full, "utf8").slice(0, 2500);
        blocks.push(`### ${hit.relativePath}\n${text}`);
        surfaced.add(hit.relativePath);
      } catch {
        /* skip missing */
      }
    }
    session.alreadySurfacedMemoryPaths = [...surfaced];
    systemPromptFinal = systemPrompt + blocks.join("\n");
  }

  // 3. 确保 system message 在对话历史头部
  if (
    session.conversationHistory.length === 0 ||
    session.conversationHistory[0].role !== "system"
  ) {
    session.conversationHistory.unshift({
      role: "system",
      content: systemPromptFinal,
      timestamp: new Date().toISOString(),
    });
  } else {
    session.conversationHistory[0].content = systemPromptFinal;
    session.conversationHistory[0].timestamp = new Date().toISOString();
  }

  // 4. 添加用户消息
  session.conversationHistory.push({
    role: "user",
    content: instruction,
    timestamp: new Date().toISOString(),
  });

  // W7：Role.allowedToolNames 优先；回退到 preset.allowedToolNames。
  const allowNamesRaw = roleForTools?.allowedToolNames ?? presetForTools?.allowedToolNames;
  const baseNames =
    allowNamesRaw && allowNamesRaw.length > 0
      ? allowNamesRaw
      : registry.toOpenAITools().map((t) => t.function.name);
  const filteredNames = filterToolsForPermissionMode(baseNames, permissionMode);
  const openAITools = registry
    .toOpenAITools()
    .filter((t) => filteredNames.includes(t.function.name));
  const turn: AgentTurn = {
    turnId,
    sessionId: session.sessionId,
    instruction,
    messages: [],
    toolCallsExecuted: 0,
    status: "running",
    gateDecisions: [],
    startedAt,
  };

  let finalReply = "";
  let pendingClarificationQuestions: ClarificationQuestion[] = [];

  const runToolPipeline = composeToolPipeline(buildDefaultToolPipeline());

  const liveProgressKey = opts.liveProgressSessionId?.trim() || session.sessionId;
  if (liveProgressKey) {
    beginLiveTurnProgress(liveProgressKey);
  }

  const emitEvent = (event: RunTurnEvent): void => {
    if (liveProgressKey) {
      applyLiveTurnEvent(liveProgressKey, event);
    }
    if (!opts.onEvent) {
      return;
    }
    try {
      opts.onEvent(event);
    } catch {
      /* ignore consumer errors */
    }
  };

  const policyForCompact = readWorkspacePolicyFile(config.workspaceDir);
  const tokenBudget = estimateTokenBudget(session, policyForCompact);
  emitEvent({
    type: "token_budget",
    used: tokenBudget.used,
    effectiveLimit: tokenBudget.effectiveLimit,
    level: tokenBudget.level,
  });
  const compactResult = autoCompactSessionHistory(session, config.workspaceDir, {
    maxHistoryMessages: maxHistory,
    policy: policyForCompact,
    linkedTaskId: linkedTaskIdForCtx,
  });
  session.conversationHistory = compactResult.messages;
  if (compactResult.compacted) {
    emitEvent({
      type: "compact_boundary",
      sessionSummaryPath: compactResult.sessionSummaryPath,
      droppedMessageCount: compactResult.droppedMessageCount,
    });
  }

  let liveProgressFinished = false;
  const ensureLiveProgressFinished = (status: "completed" | "failed"): void => {
    if (!liveProgressKey || liveProgressFinished) {
      return;
    }
    liveProgressFinished = true;
    finishLiveTurnProgress(liveProgressKey, status);
  };

  const finishShortCircuitTurn = (
    shortReply: string,
  ): {
    turn: AgentTurn;
    reply: string;
    sessionId: string;
    memoryContext: MemoryContext;
  } => {
    const agentMsg: AgentMessage = {
      role: "assistant",
      content: shortReply,
      timestamp: new Date().toISOString(),
    };
    session.conversationHistory.push(agentMsg);
    turn.messages.push(agentMsg);
    turn.status = "completed";
    finalReply = shortReply;
    turn.result = finalReply;
    turn.completedAt = new Date().toISOString();
    emitEvent({ type: "round_start", roundIndex: 1 });
    emitEvent({ type: "delta", roundIndex: 1, text: shortReply });
    emitEvent({ type: "final", status: "completed", reply: shortReply });
    maybeUpdateSessionTitleFromInstruction(session, turn.instruction, sessionTitleHint);
    session.turns.push({
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      instruction: turn.instruction,
      messages: turn.messages,
      toolCallsExecuted: 0,
      status: turn.status,
      gateDecisions: turn.gateDecisions,
      executionState: {
        ...executionStateFromTurn(turn),
        linkedTaskId: linkedTaskIdForCtx,
      },
      result: turn.result,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
    });
    appendTurn(config.workspaceDir, turn);
    ensureLiveProgressFinished("completed");
    attachPersistedLiveTraceToLastAssistant(session, liveProgressKey, {
      ...executionStateFromTurn(turn),
      linkedTaskId: linkedTaskIdForCtx,
    });
    saveSession(config.workspaceDir, session);
    return { turn, reply: finalReply, sessionId: session.sessionId, memoryContext: memory };
  };

  try {
    const modelIdentityReply = tryBuildModelIdentityReply(instruction, config.runtimeModel);
    if (modelIdentityReply) {
      return finishShortCircuitTurn(modelIdentityReply);
    }

    const connectivityReply = await tryBuildModelConnectivityCheckReply({
      instruction,
      identity: config.runtimeModel,
      modelConfig: config.model,
      lawMindRoot,
    });
    if (connectivityReply) {
      return finishShortCircuitTurn(connectivityReply);
    }

    if (shouldAutoRunDeliverableWorkflow(instruction)) {
      const autoWfRound = 1;
      const autoWfToolId = "auto-deliverable-wf";
      emitEvent({ type: "round_start", roundIndex: autoWfRound });
      emitEvent({
        type: "tool_call_start",
        roundIndex: autoWfRound,
        toolCallId: autoWfToolId,
        toolName: "execute_workflow",
        args: { instruction },
      });
      ctx.emitToolProgress = (label) =>
        emitEvent({
          type: "tool_progress",
          roundIndex: autoWfRound,
          toolCallId: autoWfToolId,
          toolName: "execute_workflow",
          label,
        });
      let wfResult: Awaited<ReturnType<typeof executeWorkflow.execute>>;
      try {
        wfResult = await executeWorkflow.execute(
          {
            instruction,
            matter_id: session.matterId,
            auto_approve: false,
          },
          ctx,
        );
      } finally {
        ctx.emitToolProgress = undefined;
      }
      emitEvent({
        type: "tool_call_end",
        roundIndex: autoWfRound,
        toolCallId: autoWfToolId,
        toolName: "execute_workflow",
        ok: wfResult.ok,
        error: wfResult.error,
      });
      const wfData =
        wfResult.data && typeof wfResult.data === "object"
          ? (wfResult.data as Record<string, unknown>)
          : {};
      const wfReply = formatDeliverableWorkflowReply({
        taskId: typeof wfData.taskId === "string" ? wfData.taskId : undefined,
        title: typeof wfData.title === "string" ? wfData.title : undefined,
        deliverableType:
          typeof wfData.deliverableType === "string" ? wfData.deliverableType : undefined,
        status: typeof wfData.status === "string" ? wfData.status : undefined,
        sectionsCount: typeof wfData.sectionsCount === "number" ? wfData.sectionsCount : undefined,
        steps: Array.isArray(wfData.steps) ? (wfData.steps as string[]) : undefined,
        outputPath: typeof wfData.outputPath === "string" ? wfData.outputPath : undefined,
        researchDegraded: wfData.researchDegraded === true,
        error: wfResult.ok ? undefined : wfResult.error,
      });
      if (wfResult.ok || typeof wfData.taskId === "string") {
        return finishShortCircuitTurn(wfReply);
      }
    }

    // 5. 主循环：call model → execute tools → repeat
    let loopCount = 0;
    let turnUsage: ModelUsageSnapshot | undefined;

    /**
     * Strict mode (default when `LAWMIND_STRICT_TOOL_STREAM` is unset): do **not**
     * open upstream `stream: true` until this turn already has `role: tool` messages
     * (i.e. after at least one tool round), matching the Cursor-parity contract that
     * tool-selection hops stay JSON completions. Clients still receive SSE *events*
     * for round_start/tool_call/etc.; only upstream token streaming waits until
     * post-tool completions. Relax with `LAWMIND_STRICT_TOOL_STREAM=0`.
     */
    const strictUpstreamToolStreaming =
      opts.onEvent &&
      !(
        process.env.LAWMIND_STRICT_TOOL_STREAM === "0" ||
        ["false", "off"].includes(
          process.env.LAWMIND_STRICT_TOOL_STREAM?.trim().toLowerCase() ?? "",
        )
      );

    while (loopCount < maxToolCalls + 1) {
      loopCount++;
      const roundIndex = loopCount;
      emitEvent({ type: "round_start", roundIndex });

      const modelMessages = toModelMessages(session);
      const hadToolResponsesThisTurn = turn.messages.some((m) => m.role === "tool");
      const useUpstreamTokenStream =
        Boolean(opts.onEvent) &&
        (!strictUpstreamToolStreaming || openAITools.length === 0 || hadToolResponsesThisTurn);

      const response = await callModelWithRetry(config.model, modelMessages, openAITools, {
        stream: useUpstreamTokenStream,
        onDelta: useUpstreamTokenStream
          ? (chunk: string) => emitEvent({ type: "delta", roundIndex, text: chunk })
          : undefined,
      });
      turnUsage = mergeUsageSnapshots(turnUsage, usageFromProvider(response.usage));

      const choice = response.choices[0];
      if (!choice) {
        turn.status = "error";
        turn.error = "Empty response from model";
        break;
      }

      const assistantMsg = choice.message;
      const toolCalls = assistantMsg.tool_calls;

      if (!useUpstreamTokenStream) {
        const segment = assistantMsg.content ?? "";
        if (segment.length > 0) {
          emitEvent({ type: "delta", roundIndex, text: segment });
        }
      }

      // 记录 assistant 消息
      const agentMsg: AgentMessage = {
        role: "assistant",
        content: assistantMsg.content ?? "",
        timestamp: new Date().toISOString(),
      };

      if (toolCalls && toolCalls.length > 0) {
        agentMsg.toolCalls = toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: safeParse(tc.function.arguments),
        }));
      }

      session.conversationHistory.push(agentMsg);
      turn.messages.push(agentMsg);

      // 没有 tool calls → 最终回答
      if (!toolCalls || toolCalls.length === 0) {
        if (pendingClarificationQuestions.length > 0) {
          finalReply = buildClarificationReply(
            assistantMsg.content ?? "",
            pendingClarificationQuestions,
          );
          turn.status = "awaiting_clarification";
          turn.clarificationQuestions = pendingClarificationQuestions;
        } else {
          finalReply = assistantMsg.content ?? "";
          turn.status = "completed";
        }
        break;
      }

      // 执行 tool calls — 通过 ToolPolicy pipeline（W2）；只读批可并发
      const toolRefs: ToolCallRef[] = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParse(tc.function.arguments),
      }));
      const toolBatches = partitionToolCalls(toolRefs, registry);
      toolBatchLoop: for (const batch of toolBatches) {
        const runOne = async (ref: ToolCallRef): Promise<void> => {
          const tc = {
            id: ref.id,
            function: { name: ref.name, arguments: JSON.stringify(ref.arguments) },
          };
          ctx.clarificationBlockingHeavyTools = pendingClarificationQuestions.length > 0;
          turn.toolCallsExecuted++;

          const toolName = tc.function.name;
          const toolArgs = { ...ref.arguments };
          if (ctx.preApproveToolName && ctx.preApproveToolName === toolName) {
            toolArgs.__approved = true;
            if (ctx.preApproveToolArgs && typeof ctx.preApproveToolArgs === "object") {
              Object.assign(toolArgs, ctx.preApproveToolArgs);
            }
          }
          emitEvent({
            type: "tool_call_start",
            roundIndex,
            toolCallId: tc.id,
            toolName,
            args: toolArgs,
          });
          ctx.emitToolProgress = (label: string) => {
            emitEvent({
              type: "tool_progress",
              roundIndex,
              toolCallId: tc.id,
              toolName,
              label,
            });
          };
          const callCtx: ToolCallContext = {
            toolCallId: tc.id,
            toolName,
            args: toolArgs,
            tool: registry.get(toolName),
            ctx,
            turn: { turnId: turn.turnId },
            policy: {
              usedToolCalls: turn.toolCallsExecuted,
              maxToolCalls,
              toolTimeoutMs,
              strictDangerousToolApproval,
              allowDangerousToolsWithoutApproval,
              toolSandboxEnabled,
              allowedToolNames: roleForTools?.allowedToolNames ?? presetForTools?.allowedToolNames,
              roleId: roleForTools?.roleId,
              riskCeiling: roleForTools?.riskCeiling ?? presetForTools?.riskCeiling,
              actorId,
              auditDir: `${config.workspaceDir}/audit`,
              sessionMatterId: session.matterId,
              sessionAssistantId: session.assistantId,
            },
          };
          const result = await runToolPipeline(callCtx);
          emitEvent({
            type: "tool_call_end",
            roundIndex,
            toolCallId: tc.id,
            toolName,
            ok: result.ok,
            error: result.ok ? undefined : extractToolErrorMessage(result),
          });
          ctx.emitToolProgress = undefined;

          const toolResponseMsg: AgentMessage = {
            role: "tool",
            content: JSON.stringify(result),
            toolCallResponses: [{ toolCallId: tc.id, name: toolName, result }],
            timestamp: new Date().toISOString(),
          };
          session.conversationHistory.push(toolResponseMsg);
          turn.messages.push(toolResponseMsg);

          const clarificationQuestions = extractClarificationQuestions(result);
          if (clarificationQuestions.length > 0) {
            pendingClarificationQuestions = clarificationQuestions;
          }

          if (result.pendingApproval) {
            const gateDecision: GateDecision = {
              gate: "approval_gate",
              decision: "awaiting_confirmation",
              reason: `工具 ${toolName} 返回 pendingApproval`,
            };
            turn.gateDecisions?.push(gateDecision);
            turn.status = "awaiting_approval";
            turn.pendingToolApproval = {
              toolName,
              toolCallId: tc.id,
              toolArgs,
            };
            finalReply = assistantMsg.content ?? `操作 ${toolName} 需要您的确认。`;
          }
        };
        if (batch.concurrencySafe && batch.calls.length > 1) {
          await Promise.all(batch.calls.map((ref) => runOne(ref)));
        } else {
          for (const ref of batch.calls) {
            await runOne(ref);
            if (turn.status === "awaiting_approval") {
              break toolBatchLoop;
            }
          }
        }
        if (turn.status === "awaiting_approval") {
          break toolBatchLoop;
        }
      }

      if (turn.status === "awaiting_approval") {
        break;
      }

      // 检查是否达到工具调用上限
      if (turn.toolCallsExecuted >= maxToolCalls) {
        if (pendingClarificationQuestions.length > 0) {
          turn.status = "awaiting_clarification";
          turn.clarificationQuestions = pendingClarificationQuestions;
          finalReply = buildClarificationReply(
            assistantMsg.content ?? "",
            pendingClarificationQuestions,
            "已生成带待补充项的正式草稿，但当前轮次已达到工具调用上限。为完成最终交付，请补充：",
          );
        } else {
          turn.status = "completed";
          finalReply = assistantMsg.content ?? "已达到工具调用上限。";
        }
        break;
      }
    }

    if (!finalReply.trim() && turn.toolCallsExecuted > 0) {
      finalReply = buildTurnReplyFallback(turn);
    }
    turn.result = finalReply;
    turn.completedAt = new Date().toISOString();

    if (turn.status === "running") {
      if (pendingClarificationQuestions.length > 0) {
        turn.status = "awaiting_clarification";
        turn.gateDecisions?.push({
          gate: "clarification_gate",
          decision: "awaiting_confirmation",
          reason: "本轮含待澄清问题。",
        });
        turn.clarificationQuestions = pendingClarificationQuestions;
        if (!turn.result?.trim()) {
          turn.result = buildClarificationReply("", pendingClarificationQuestions);
        }
      } else {
        turn.status = "completed";
      }
    }

    if (turn.status === "awaiting_clarification" && turn.clarificationQuestions?.length) {
      session.pendingClarificationKeys = turn.clarificationQuestions.map((q) => q.key);
      emitEvent({ type: "clarification", questions: turn.clarificationQuestions });
    } else {
      delete session.pendingClarificationKeys;
    }
    emitEvent({ type: "final", status: turn.status, reply: turn.result ?? "" });
    turn.executionState = {
      ...executionStateFromTurn(turn),
      linkedTaskId: linkedTaskIdForCtx,
    };

    turn.requiresAction = buildRequiresActionsFromTurn({
      status: turn.status,
      clarificationQuestions: turn.clarificationQuestions,
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      matterId: session.matterId,
      pendingToolApproval: turn.pendingToolApproval,
    });
    if (turn.requiresAction.length > 0) {
      session.pendingRequiresAction = turn.requiresAction;
    } else {
      delete session.pendingRequiresAction;
    }

    // 6. 保存 session
    maybeUpdateSessionTitleFromInstruction(session, turn.instruction, sessionTitleHint);

    session.turns.push({
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      instruction: turn.instruction,
      messages: [],
      toolCallsExecuted: turn.toolCallsExecuted,
      status: turn.status,
      clarificationQuestions: turn.clarificationQuestions,
      gateDecisions: turn.gateDecisions,
      executionState: turn.executionState,
      requiresAction: turn.requiresAction,
      pendingToolApproval: turn.pendingToolApproval,
      result: turn.result,
      error: turn.error,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
    });

    ensureLiveProgressFinished(turn.status === "error" ? "failed" : "completed");
    attachPersistedLiveTraceToLastAssistant(session, liveProgressKey, turn.executionState);
    if (turnUsage) {
      turn.modelUsage = turnUsage;
    }
    saveSession(config.workspaceDir, session);
    appendTurn(config.workspaceDir, turn);
    if (turn.status === "completed" || turn.status === "awaiting_clarification") {
      maybeAutoAppendSessionSummary(config.workspaceDir, session, turn);
      saveSession(config.workspaceDir, session);
    }

    if (turnUsage && turn.status !== "error") {
      try {
        recordModelUsage(config.workspaceDir, {
          sessionId: session.sessionId,
          turnId: turn.turnId,
          matterId: session.matterId,
          model: config.model.model,
          promptTokens: turnUsage.promptTokens,
          completionTokens: turnUsage.completionTokens,
          totalTokens: turnUsage.totalTokens,
        });
      } catch {
        /* ledger is best-effort */
      }
    }

    if (turn.status !== "error") {
      try {
        persistAgentInstructionTask(config.workspaceDir, {
          taskId: turn.turnId,
          instruction: turn.instruction,
          sessionId: session.sessionId,
          matterId: session.matterId,
          assistantId: resolvedAssistantId,
        });
      } catch {
        /* ignore disk errors; chat result still returned */
      }
    }

    void emit(`${config.workspaceDir}/audit`, {
      kind: "agent_turn",
      actor: "model",
      actorId,
      detail: `turn=${turn.turnId} tools=${turn.toolCallsExecuted} status=${turn.status}`,
      taskId: turn.turnId,
    });

    if (turn.executionState || (turn.gateDecisions?.length ?? 0) > 0) {
      void emitPlatformGateSnapshot(`${config.workspaceDir}/audit`, {
        taskId: turn.turnId,
        source: "agent_turn",
        actor: "model",
        actorId,
        executionState: turn.executionState,
        gateDecisions: turn.gateDecisions,
        context: { status: turn.status },
      });
    }

    return { turn, reply: finalReply, sessionId: session.sessionId, memoryContext: memory };
  } catch (err) {
    ensureLiveProgressFinished("failed");
    attachPersistedLiveTraceToLastAssistant(session, liveProgressKey, turn.executionState);
    try {
      saveSession(config.workspaceDir, session);
    } catch {
      /* ignore disk errors */
    }
    throw err;
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// 兼容历史导入：W2 起 validateToolArguments 抽到 runtime-tool-validation.ts
export { validateToolArguments } from "./runtime-tool-validation.js";
