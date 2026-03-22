/**
 * LawMind Agent 核心类型
 *
 * 设计原则：
 *   - Agent 是一个自主推理循环，不是固定管线
 *   - Tool 是 agent 的能力单元，agent 决定何时用哪个
 *   - Session 是持久对话上下文，支持断点续做
 *   - Policy 决定哪些动作需要人工批准
 *
 * 与 OpenClaw 的关系：
 *   借鉴 OpenClaw 的 agent loop + tool dispatch 模式，
 *   但 tool 定义、policy 规则、system prompt 完全面向法律场景。
 */

import type { RiskLevel, MatterIndex } from "../types.js";

// ─────────────────────────────────────────────
// 1. Tool System
// ─────────────────────────────────────────────

export type ToolParameterSchema = {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  enum?: string[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  category: "search" | "analyze" | "draft" | "matter" | "review" | "system";
  parameters: Record<string, ToolParameterSchema>;
  requiresApproval?: boolean;
  riskLevel?: RiskLevel;
};

export type ToolCallResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** 该工具调用是否需要人工确认后才能生效 */
  pendingApproval?: boolean;
};

export type ToolExecutor = (
  params: Record<string, unknown>,
  ctx: AgentContext,
) => Promise<ToolCallResult>;

export type AgentTool = {
  definition: ToolDefinition;
  execute: ToolExecutor;
};

// ─────────────────────────────────────────────
// 2. Agent Context — 每次 turn 的运行环境
// ─────────────────────────────────────────────

export type AgentContext = {
  workspaceDir: string;
  sessionId: string;
  matterId?: string;
  actorId: string;
  /** 多助手档案 ID（若有） */
  assistantId?: string;
  /** 本轮是否允许调用 web_search 等联网工具 */
  allowWebSearch?: boolean;
  /** 当前案件的索引快照（按需加载） */
  matterIndex?: MatterIndex;
};

// ─────────────────────────────────────────────
// 3. Agent Message — 对话消息
// ─────────────────────────────────────────────

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolCallResponse = {
  toolCallId: string;
  name: string;
  result: ToolCallResult;
};

export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallResponses?: ToolCallResponse[];
  timestamp: string;
};

// ─────────────────────────────────────────────
// 4. Agent Turn — 一次完整的推理-执行循环
// ─────────────────────────────────────────────

export type AgentTurnStatus = "running" | "completed" | "awaiting_approval" | "error";

export type AgentTurn = {
  turnId: string;
  sessionId: string;
  instruction: string;
  messages: AgentMessage[];
  toolCallsExecuted: number;
  status: AgentTurnStatus;
  result?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
};

// ─────────────────────────────────────────────
// 5. Agent Session — 持久对话
// ─────────────────────────────────────────────

export type AgentSession = {
  sessionId: string;
  matterId?: string;
  actorId: string;
  /** 桌面多助手：关联的助手 ID（旧会话可能无此字段） */
  assistantId?: string;
  turns: AgentTurn[];
  /** 对话历史（发送给模型的精简版） */
  conversationHistory: AgentMessage[];
  createdAt: string;
  updatedAt: string;
};

// ─────────────────────────────────────────────
// 6. Agent Config
// ─────────────────────────────────────────────

export type AgentModelConfig = {
  provider: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
};

export type AgentConfig = {
  workspaceDir: string;
  model: AgentModelConfig;
  /** 最大单次 turn 的工具调用次数 */
  maxToolCalls?: number;
  /** 最大对话历史消息数（超过时压缩） */
  maxHistoryMessages?: number;
  /** 工具执行超时（毫秒） */
  toolExecutionTimeoutMs?: number;
  /** 是否允许跳过 requiresApproval 工具门禁 */
  allowDangerousToolsWithoutApproval?: boolean;
  actorId?: string;
  /** 多助手：助手档案 ID，与 actorId `assistant:<id>` 对应 */
  assistantId?: string;
  /** 岗位展示名 */
  roleTitle?: string;
  /** 助手简介，注入 system prompt */
  roleIntroduction?: string;
  /** 预设 + 用户自定义合并后的岗位指令 */
  roleDirective?: string;
  /** 是否注册并允许使用联网检索工具（web_search，Brave API） */
  allowWebSearch?: boolean;
};
