/**
 * LawMind Agent 核心类型
 *
 * 设计原则：
 *   - Agent 是一个自主推理循环，不是固定管线
 *   - Tool 是 agent 的能力单元，agent 决定何时用哪个
 *   - Session 是持久对话上下文，支持断点续做
 *   - Policy 决定哪些动作需要人工批准
 *
 * 与 reference agent stack 的关系：
 *   借鉴 reference agent stack 的 agent loop + tool dispatch 模式，
 *   但 tool 定义、policy 规则、system prompt 完全面向法律场景。
 */

import type { GateDecision, TaskExecutionState } from "../platform/contracts.js";
import type { LawMindRequiresAction } from "../platform/requires-action.js";
import type { ClarificationQuestion, RiskLevel, MatterIndex } from "../types.js";

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
  category: "search" | "analyze" | "draft" | "matter" | "review" | "system" | "collaboration";
  parameters: Record<string, ToolParameterSchema>;
  requiresApproval?: boolean;
  riskLevel?: RiskLevel;
  /** 可与同批只读工具并发执行 */
  isConcurrencySafe?: boolean;
  approvalTemplate?: "diff" | "readonly" | "acceptance" | "workflow" | "network" | "generic";
};

export type ToolCallResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** 该工具调用是否需要人工确认后才能生效 */
  pendingApproval?: boolean;
  /** P2：是否在子进程沙箱中执行 */
  sandboxed?: boolean;
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
  /**
   * 桌面端「项目目录」：用户选中的本机文件夹，用于 read_project_file / search_workspace 扩展检索。
   * 与 LawMind workspace 分离；路径必须在服务端校验后注入。
   */
  projectDir?: string;
  /** 本轮是否允许调用 web_search 等联网工具 */
  allowWebSearch?: boolean;
  /** 桌面 compose 权限模式（只读/严格/标准） */
  permissionMode?: "standard" | "strict" | "readonly";
  /**
   * 桌面工作台当前关联的草稿/任务 ID（可选）。
   * 工具在未显式传入 `task_id` 时可将此作为隐式默认（例如 `render_document` 优先于「最近草稿」）。
   */
  linkedTaskId?: string;
  /** 当前案件的索引快照（按需加载） */
  matterIndex?: MatterIndex;
  /** 是否启用助手间协作工具（delegate_task, consult_assistant 等） */
  collaborationEnabled?: boolean;
  /** 与桌面 local server 一致，解析 assistants.json 所在 LawMind 根目录 */
  envFile?: string;
  /** 当前委派嵌套深度（防止递归失控） */
  collaborationDepth?: number;
  /**
   * 本轮内已有工具返回 clarificationQuestions 且尚未结束 turn 时为 true；
   * draft_document / execute_workflow / render_document 应拒绝执行。
   * 只读 / research_task 仍允许，便于先收集事实再请律师澄清。
   */
  clarificationBlockingHeavyTools?: boolean;
  /** 与 `AgentConfig.strictDangerousToolApproval` 对齐，供工具层读取 */
  strictDangerousToolApproval?: boolean;
  /** 长耗时工具（如 execute_workflow）向对话 SSE 推送子步骤 */
  emitToolProgress?: (label: string) => void;
  /** resumeTurn：下一笔同名工具调用自动视为已批准 */
  preApproveToolName?: string;
  /** Merged into the next call of `preApproveToolName` (lawyer-edited args). */
  preApproveToolArgs?: Record<string, unknown>;
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
  /** 持久化的执行轨迹（assistant 消息，供桌面 reload 后展示） */
  liveTrace?: PersistedChatLiveTrace;
  executionState?: TaskExecutionState;
};

/** 已完成 turn 的执行轨迹快照（不含 active 字段） */
export type PersistedChatLiveTrace = {
  currentRound?: number;
  steps: Array<{
    id: string;
    kind: "round" | "tool" | "workflow";
    label: string;
    status: "running" | "done" | "failed";
    detail?: string;
  }>;
};

// ─────────────────────────────────────────────
// 4. Agent Turn — 一次完整的推理-执行循环
// ─────────────────────────────────────────────

export type AgentTurnStatus =
  | "running"
  | "completed"
  | "awaiting_approval"
  | "awaiting_clarification"
  | "error";

export type AgentTurn = {
  turnId: string;
  sessionId: string;
  instruction: string;
  messages: AgentMessage[];
  toolCallsExecuted: number;
  status: AgentTurnStatus;
  clarificationQuestions?: ClarificationQuestion[];
  /** Big-Bang: 执行状态机快照（供 API/UI 统一消费） */
  executionState?: TaskExecutionState;
  /** Big-Bang: 本轮门禁判定轨迹 */
  gateDecisions?: GateDecision[];
  /** 律师待处理动作（澄清、工具批准等） */
  requiresAction?: LawMindRequiresAction[];
  /** 中断时待批准的工具调用（用于 resume） */
  pendingToolApproval?: {
    toolName: string;
    toolCallId: string;
    toolArgs: Record<string, unknown>;
  };
  result?: string;
  error?: string;
  /** Provider token usage for this turn (when reported). */
  modelUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  startedAt: string;
  completedAt?: string;
};

// ─────────────────────────────────────────────
// 5. Agent Session — 持久对话
// ─────────────────────────────────────────────

export type AgentSession = {
  sessionId: string;
  /** 对话标签（桌面多窗口）；缺省或空时 UI 显示为「New Chat」 */
  title?: string;
  matterId?: string;
  actorId: string;
  /** 桌面多助手：关联的助手 ID（旧会话可能无此字段） */
  assistantId?: string;
  turns: AgentTurn[];
  /** 对话历史（发送给模型的精简版） */
  conversationHistory: AgentMessage[];
  createdAt: string;
  updatedAt: string;
  /**
   * 上一轮 turn 以 awaiting_clarification 结束时写入；下一则用户 instruction 到达时清除，
   * 以便同一轮内可继续调用重型工具。
   */
  pendingClarificationKeys?: string[];
  /** 当前会话待 resume 的动作（与最后一轮 awaiting_* turn 对齐） */
  pendingRequiresAction?: LawMindRequiresAction[];
  /** 本轮/本会话已注入 prompt 的记忆文件路径（findRelevantMemories 去重） */
  alreadySurfacedMemoryPaths?: string[];
  /** 协作委派子会话：写入独立 transcript（`delegations/<id>.transcript.jsonl`） */
  collaborationDelegationId?: string;
  /** 上次自动写入 session-summary 时的 turn 数（用于节流） */
  lastSessionSummaryTurnCount?: number;
  /**
   * Plan→Execute 交接（「先计划」产出）：写入 session.json，便于刷新 / 跨端同工作区恢复。
   * 桌面仍可镜像到 localStorage 作离线缓存。
   */
  planHandoff?: {
    planText: string;
    updatedAt: string;
  };
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
  /** Catalog / custom context window; drives compact budget when set. */
  contextTokens?: number;
};

/** Non-secret model identity for system prompt (lawyer may ask「你是什么模型」). */
export type AgentRuntimeModelIdentity = {
  /** Label shown in desktop model picker / settings. */
  catalogLabel: string;
  /** Human-readable provider name (no API keys). */
  providerLabel: string;
  /** Upstream model id sent to chat/completions. */
  upstreamModel: string;
  catalogId?: string;
};

export type AgentConfig = {
  workspaceDir: string;
  model: AgentModelConfig;
  /** Resolved model identity for honest「你是什么模型」answers (no secrets). */
  runtimeModel?: AgentRuntimeModelIdentity;
  /** 最大单次 turn 的工具调用次数 */
  maxToolCalls?: number;
  /** 最大对话历史消息数（超过时压缩） */
  maxHistoryMessages?: number;
  /** 工具执行超时（毫秒） */
  toolExecutionTimeoutMs?: number;
  /** 是否允许跳过 requiresApproval 工具门禁 */
  allowDangerousToolsWithoutApproval?: boolean;
  /**
   * Firm / private_deploy：危险工具与扩展清单（如 execute_workflow）一律要求 `__approved`，
   * 即使 `allowDangerousToolsWithoutApproval` 为 true。
   */
  strictDangerousToolApproval?: boolean;
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
  /** 桌面 compose 权限模式 */
  permissionMode?: "standard" | "strict" | "readonly";
  /** 是否注册助手间协作工具（delegate_task, consult_assistant 等） */
  enableCollaboration?: boolean;
  /** 与桌面 local server 一致，用于解析 assistants.json 所在 LawMind 根目录 */
  envFile?: string;
  /**
   * 可选：当前会话关联的「项目目录」（本机路径），与 Electron 侧 projectDir 对齐。
   * 供工具检索项目内文本文件；不设则仅搜索 LawMind workspace 记忆文件。
   */
  projectDir?: string;
};
