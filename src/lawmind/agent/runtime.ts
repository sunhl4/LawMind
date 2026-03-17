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
 * 与 OpenClaw 的差异：
 *   - OpenClaw 基于 pi-agent-core / pi-coding-agent
 *   - LawMind 直接使用 OpenAI compatible API + 自建工具调度
 *   - 但设计理念相同：LLM 驱动的自主推理 + tool use
 */

import { randomUUID } from "node:crypto";
import { emit } from "../audit/index.js";
import { loadMemoryContext } from "../memory/index.js";
import {
  appendTurn,
  compactHistory,
  createSession,
  loadSession,
  saveSession,
  toModelMessages,
} from "./session.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { ToolRegistry } from "./tools/registry.js";
import type {
  AgentConfig,
  AgentContext,
  AgentMessage,
  AgentModelConfig,
  AgentTurn,
  ToolDefinition,
} from "./types.js";

const DEFAULT_MAX_TOOL_CALLS = 15;
const DEFAULT_MAX_HISTORY_MESSAGES = 50;
const DEFAULT_MODEL_TIMEOUT_MS = 20000;
const DEFAULT_MODEL_MAX_RETRIES = 2;
const DEFAULT_TOOL_TIMEOUT_MS = 30000;

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Model API error ${response.status}: ${text.slice(0, 500)}`);
  }

  return (await response.json()) as ChatCompletionResponse;
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
): Promise<ChatCompletionResponse> {
  const maxRetries = config.maxRetries ?? DEFAULT_MODEL_MAX_RETRIES;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await callModelOnce(config, messages, tools);
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
 * Agent 的一次完整 turn（从用户指令到最终回答）
 */
export async function runTurn(opts: {
  config: AgentConfig;
  registry: ToolRegistry;
  sessionId?: string;
  instruction: string;
  matterId?: string;
}): Promise<{ turn: AgentTurn; reply: string; sessionId: string }> {
  const { config, registry, instruction, matterId } = opts;
  const maxToolCalls = config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const maxHistory = config.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
  const toolTimeoutMs = config.toolExecutionTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const allowDangerousToolsWithoutApproval = config.allowDangerousToolsWithoutApproval ?? false;
  const actorId = config.actorId ?? "system";

  // 1. 加载或创建 session
  let session = opts.sessionId ? loadSession(config.workspaceDir, opts.sessionId) : undefined;
  if (!session) {
    session = createSession({ workspaceDir: config.workspaceDir, matterId, actorId });
  }

  if (matterId && !session.matterId) {
    session.matterId = matterId;
  }

  const turnId = randomUUID();
  const startedAt = new Date().toISOString();

  const ctx: AgentContext = {
    workspaceDir: config.workspaceDir,
    sessionId: session.sessionId,
    matterId: session.matterId,
    actorId,
  };

  // 2. 构建 system prompt
  const memory = await loadMemoryContext(config.workspaceDir, { matterId: session.matterId });
  const systemPrompt = buildSystemPrompt({
    lawyerProfile: memory.profile,
    matterContext: memory.caseMemory,
    todayLog: memory.todayLog,
    availableTools: registry.listDefinitions(),
    matterId: session.matterId,
  });

  // 3. 确保 system message 在对话历史头部
  if (
    session.conversationHistory.length === 0 ||
    session.conversationHistory[0].role !== "system"
  ) {
    session.conversationHistory.unshift({
      role: "system",
      content: systemPrompt,
      timestamp: new Date().toISOString(),
    });
  } else {
    session.conversationHistory[0].content = systemPrompt;
    session.conversationHistory[0].timestamp = new Date().toISOString();
  }

  // 4. 添加用户消息
  session.conversationHistory.push({
    role: "user",
    content: instruction,
    timestamp: new Date().toISOString(),
  });

  // 压缩历史
  session.conversationHistory = compactHistory(session.conversationHistory, maxHistory);

  const openAITools = registry.toOpenAITools();
  const turn: AgentTurn = {
    turnId,
    sessionId: session.sessionId,
    instruction,
    messages: [],
    toolCallsExecuted: 0,
    status: "running",
    startedAt,
  };

  // 5. 主循环：call model → execute tools → repeat
  let loopCount = 0;
  let finalReply = "";

  while (loopCount < maxToolCalls + 1) {
    loopCount++;

    const modelMessages = toModelMessages(session);
    const response = await callModelWithRetry(config.model, modelMessages, openAITools);

    const choice = response.choices[0];
    if (!choice) {
      turn.status = "error";
      turn.error = "Empty response from model";
      break;
    }

    const assistantMsg = choice.message;
    const toolCalls = assistantMsg.tool_calls;

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
      finalReply = assistantMsg.content ?? "";
      turn.status = "completed";
      break;
    }

    // 执行 tool calls
    for (const tc of toolCalls) {
      const toolName = tc.function.name;
      const toolArgs = safeParse(tc.function.arguments);
      const tool = registry.get(toolName);

      let result: { ok: boolean; data?: unknown; error?: string; pendingApproval?: boolean };
      if (!tool) {
        result = { ok: false, error: `Unknown tool: ${toolName}` };
      } else {
        const validationError = validateToolArguments(tool.definition, toolArgs);
        if (validationError) {
          result = { ok: false, error: `Invalid arguments for ${toolName}: ${validationError}` };
        } else if (
          tool.definition.requiresApproval &&
          !allowDangerousToolsWithoutApproval &&
          toolArgs.__approved !== true
        ) {
          result = {
            ok: false,
            error: `Tool ${toolName} requires lawyer approval. Retry with "__approved": true after explicit confirmation.`,
            pendingApproval: true,
          };
        } else {
          try {
            result = await withTimeout(
              tool.execute(toolArgs, ctx),
              toolTimeoutMs,
              `Tool ${toolName} timed out after ${toolTimeoutMs}ms`,
            );
          } catch (err) {
            result = {
              ok: false,
              error: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
            };
          }
        }
      }

      void emit(`${config.workspaceDir}/audit`, {
        kind: "tool_call",
        actor: actorId,
        detail: `tool=${toolName} ok=${result.ok}${result.error ? ` error=${result.error}` : ""}`,
        taskId: turn.turnId,
      });

      turn.toolCallsExecuted++;

      // 将工具结果添加到对话
      const toolResponseMsg: AgentMessage = {
        role: "tool",
        content: JSON.stringify(result),
        toolCallResponses: [{ toolCallId: tc.id, name: toolName, result }],
        timestamp: new Date().toISOString(),
      };
      session.conversationHistory.push(toolResponseMsg);
      turn.messages.push(toolResponseMsg);

      if (result.pendingApproval) {
        turn.status = "awaiting_approval";
        finalReply = assistantMsg.content ?? `操作 ${toolName} 需要您的确认。`;
        break;
      }
    }

    if (turn.status === "awaiting_approval") {
      break;
    }

    // 检查是否达到工具调用上限
    if (turn.toolCallsExecuted >= maxToolCalls) {
      turn.status = "completed";
      finalReply = assistantMsg.content ?? "已达到工具调用上限。";
      break;
    }
  }

  turn.result = finalReply;
  turn.completedAt = new Date().toISOString();
  if (turn.status === "running") {
    turn.status = "completed";
  }

  // 6. 保存 session
  session.turns.push({
    turnId: turn.turnId,
    sessionId: turn.sessionId,
    instruction: turn.instruction,
    messages: [],
    toolCallsExecuted: turn.toolCallsExecuted,
    status: turn.status,
    result: turn.result,
    error: turn.error,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
  });

  saveSession(config.workspaceDir, session);
  appendTurn(config.workspaceDir, turn);

  void emit(`${config.workspaceDir}/audit`, {
    kind: "agent_turn",
    actor: actorId,
    detail: `turn=${turn.turnId} tools=${turn.toolCallsExecuted} status=${turn.status}`,
    taskId: turn.turnId,
  });

  return { turn, reply: finalReply, sessionId: session.sessionId };
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function valueMatchesType(
  value: unknown,
  type: ToolDefinition["parameters"][string]["type"],
): boolean {
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  return typeof value === type;
}

export function validateToolArguments(
  definition: ToolDefinition,
  args: Record<string, unknown>,
): string | undefined {
  const unknownKeys = Object.keys(args).filter(
    (key) =>
      !Object.prototype.hasOwnProperty.call(definition.parameters, key) && key !== "__approved",
  );
  if (unknownKeys.length > 0) {
    return `unknown keys: ${unknownKeys.join(", ")}`;
  }

  for (const [name, schema] of Object.entries(definition.parameters)) {
    const value = args[name];
    if (schema.required && value === undefined) {
      return `missing required key "${name}"`;
    }
    if (value === undefined) {
      continue;
    }
    if (!valueMatchesType(value, schema.type)) {
      return `key "${name}" expects ${schema.type}`;
    }
    if (schema.enum) {
      const str = typeof value === "string" ? value : JSON.stringify(value);
      if (!schema.enum.includes(str)) {
        return `key "${name}" must be one of: ${schema.enum.join(", ")}`;
      }
    }
  }
  return undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
