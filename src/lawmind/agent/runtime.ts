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
import {
  formatCurrentAssistantOrgLine,
  formatTeamOrgOverviewForPrompt,
} from "../assistants/org-prompt.js";
import { readAssistantProfileMarkdown } from "../assistants/profile-md.js";
import {
  getAssistantById,
  loadAssistantProfiles,
  buildRoleDirectiveFromProfile,
  resolveLawMindRoot,
} from "../assistants/store.js";
import { emit } from "../audit/index.js";
import { getRoleById } from "../core/role.js";
import { loadMemoryContext, type MemoryContext } from "../memory/index.js";
import {
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
} from "../policy/workspace-policy.js";
import {
  buildDefaultToolPipeline,
  composeToolPipeline,
  type ToolCallContext,
} from "../runtime/tool-pipeline.js";
import { persistAgentInstructionTask } from "../tasks/index.js";
import type { ClarificationQuestion } from "../types.js";
import { getAssistantPreset } from "./assistant-presets.js";
import {
  describeModelApiFailure,
  isNonRetryableModelApiError,
  ModelApiError,
} from "./model-api-error.js";
import {
  appendTurn,
  compactHistory,
  createSession,
  loadSession,
  maybeUpdateSessionTitleFromInstruction,
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

function buildClarificationReply(
  assistantReply: string,
  questions: ClarificationQuestion[],
  intro = "已生成可继续编辑的正式草稿，但要完成最终交付，还需要你补充以下关键信息：",
): string {
  const body = questions.map((item, index) => `${index + 1}. ${item.question}`).join("\n");
  const prefix = assistantReply.trim();
  return prefix ? `${prefix}\n\n${intro}\n${body}` : `${intro}\n${body}`;
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
    throw new ModelApiError(describeModelApiFailure(response.status, text));
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
      if (isNonRetryableModelApiError(lastError) || attempt >= maxRetries) {
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
  /** 用于会话自动标题：输入框原文（不含前缀），优先于 instruction 取前几个字 */
  sessionTitleHint?: string;
  matterId?: string;
  /** 桌面端项目目录；与会话同轮生效，供工具检索项目内文件 */
  projectDir?: string;
  /** 案件工作台团队会议室：写入 system prompt 行为约束 */
  teamMeetingMode?: boolean;
  sidecarIngestPaths?: string[];
}): Promise<{ turn: AgentTurn; reply: string; sessionId: string; memoryContext: MemoryContext }> {
  const { config, registry, instruction, matterId, sessionTitleHint } = opts;
  const projectDirResolved = (opts.projectDir ?? config.projectDir)?.trim() || undefined;
  const maxToolCalls = config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const maxHistory = config.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
  const toolTimeoutMs = config.toolExecutionTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const allowDangerousToolsWithoutApproval = config.allowDangerousToolsWithoutApproval ?? false;
  const strictDangerousToolApproval = config.strictDangerousToolApproval === true;
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
    allowWebSearch: config.allowWebSearch === true,
    collaborationEnabled: config.enableCollaboration === true,
    clarificationBlockingHeavyTools: false,
    strictDangerousToolApproval,
    sidecarIngestPaths: opts.sidecarIngestPaths,
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
  let teamOrgOverview: string | undefined;
  let assistantOrgLine: string | undefined;
  try {
    const lawMindRoot = resolveLawMindRoot(config.workspaceDir);
    const allProfiles = loadAssistantProfiles(lawMindRoot);
    teamOrgOverview = formatTeamOrgOverviewForPrompt(allProfiles);
    if (resolvedAssistantId) {
      const me = getAssistantById(lawMindRoot, resolvedAssistantId);
      assistantOrgLine = formatCurrentAssistantOrgLine(me, allProfiles);
    }
    if (config.enableCollaboration) {
      peerAssistants = allProfiles
        .filter((p) => p.assistantId !== resolvedAssistantId)
        .map((p) => {
          const role = buildRoleDirectiveFromProfile(p);
          return { id: p.assistantId, displayName: p.displayName, roleTitle: role.roleTitle };
        });
    }
  } catch {
    peerAssistants = undefined;
    teamOrgOverview = undefined;
    assistantOrgLine = undefined;
  }

  const workspacePolicy = readWorkspacePolicyFile(config.workspaceDir);
  const mandatoryRules = resolveAgentMandatoryRulesForPrompt(config.workspaceDir, workspacePolicy);

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
    projectDirectoryHint: projectDirResolved,
    agentMandatoryRules: mandatoryRules.active ? mandatoryRules.text : undefined,
    assistantOrgLine,
    teamOrgOverview,
    teamMeetingMode: opts.teamMeetingMode === true,
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

  // W7：Role.allowedToolNames 优先；回退到 preset.allowedToolNames。
  const allowNames = roleForTools?.allowedToolNames ?? presetForTools?.allowedToolNames;
  const openAITools =
    allowNames && allowNames.length > 0
      ? registry.toOpenAITools().filter((t) => allowNames.includes(t.function.name))
      : registry.toOpenAITools();
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
  let pendingClarificationQuestions: ClarificationQuestion[] = [];

  const runToolPipeline = composeToolPipeline(buildDefaultToolPipeline());

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

    // 执行 tool calls — 通过 ToolPolicy pipeline（W2）
    for (const tc of toolCalls) {
      ctx.clarificationBlockingHeavyTools = pendingClarificationQuestions.length > 0;
      turn.toolCallsExecuted++;

      const toolName = tc.function.name;
      const toolArgs = safeParse(tc.function.arguments);
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

  turn.result = finalReply;
  turn.completedAt = new Date().toISOString();

  if (turn.status === "running") {
    if (pendingClarificationQuestions.length > 0) {
      turn.status = "awaiting_clarification";
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
  } else {
    delete session.pendingClarificationKeys;
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
    result: turn.result,
    error: turn.error,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
  });

  saveSession(config.workspaceDir, session);
  appendTurn(config.workspaceDir, turn);

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

  return { turn, reply: finalReply, sessionId: session.sessionId, memoryContext: memory };
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
