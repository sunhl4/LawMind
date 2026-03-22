/**
 * LawMind Agent — 模块入口
 *
 * 暴露 agent 的完整 API：
 *   - createLawMindAgent: 创建 agent 实例
 *   - runTurn: 单次推理循环
 *   - session 管理
 *   - tool registry
 */

import { runTurn } from "./runtime.js";
import { createSession, listSessions, loadSession, loadTurns, saveSession } from "./session.js";
import { ToolRegistry, createLegalToolRegistry } from "./tools/index.js";
import type {
  AgentConfig,
  AgentMessage,
  AgentSession,
  AgentTurn,
  AgentContext,
  AgentModelConfig,
  ToolDefinition,
} from "./types.js";

export type LawMindAgent = {
  /**
   * 发送指令给 agent，agent 自主推理并回答。
   * 如果提供 sessionId，则在已有对话上继续；否则创建新对话。
   */
  chat: (
    instruction: string,
    opts?: {
      sessionId?: string;
      matterId?: string;
      assistantId?: string;
      /** 本轮是否允许 web_search（覆盖 AgentConfig） */
      allowWebSearch?: boolean;
    },
  ) => Promise<{
    reply: string;
    sessionId: string;
    turn: AgentTurn;
  }>;

  /** 创建新对话 */
  newSession: (opts?: { matterId?: string }) => AgentSession;

  /** 加载已有对话 */
  getSession: (sessionId: string) => AgentSession | undefined;

  /** 列出所有对话 */
  listSessions: () => AgentSession[];

  /** 获取对话的完整 turn 历史 */
  getTurns: (sessionId: string) => AgentTurn[];

  /** 获取工具列表 */
  listTools: () => ToolDefinition[];

  /** 获取 agent 配置 */
  getConfig: () => AgentConfig;

  /** 获取 tool registry（高级用法：注册自定义工具） */
  getRegistry: () => ToolRegistry;
};

export function createLawMindAgent(config: AgentConfig): LawMindAgent {
  const actorId =
    config.actorId ?? (config.assistantId ? `assistant:${config.assistantId}` : "lawyer");

  const defaultRegistry = () =>
    createLegalToolRegistry({ allowWebSearch: config.allowWebSearch === true });

  return {
    async chat(instruction, opts) {
      const mergedConfig: AgentConfig = {
        ...config,
        actorId,
        assistantId: opts?.assistantId ?? config.assistantId,
        allowWebSearch: opts?.allowWebSearch ?? config.allowWebSearch,
      };
      const registry = createLegalToolRegistry({
        allowWebSearch: mergedConfig.allowWebSearch === true,
      });
      const result = await runTurn({
        config: mergedConfig,
        registry,
        sessionId: opts?.sessionId,
        instruction,
        matterId: opts?.matterId,
      });

      return {
        reply: result.reply,
        sessionId: result.sessionId,
        turn: result.turn,
      };
    },

    newSession(opts) {
      return createSession({
        workspaceDir: config.workspaceDir,
        matterId: opts?.matterId,
        actorId,
        assistantId: config.assistantId,
      });
    },

    getSession(sessionId) {
      return loadSession(config.workspaceDir, sessionId);
    },

    listSessions() {
      return listSessions(config.workspaceDir);
    },

    getTurns(sessionId) {
      return loadTurns(config.workspaceDir, sessionId);
    },

    listTools() {
      return defaultRegistry().listDefinitions();
    },

    getConfig() {
      return config;
    },

    getRegistry() {
      return defaultRegistry();
    },
  };
}

// Re-export all types for external consumption
export type {
  AgentConfig,
  AgentModelConfig,
  AgentContext,
  AgentMessage,
  AgentSession,
  AgentTurn,
  AgentTurnStatus,
  ToolDefinition,
  ToolCallResult,
  ToolExecutor,
  AgentTool,
  ToolCall,
  ToolCallResponse,
} from "./types.js";

export { ToolRegistry, createLegalToolRegistry } from "./tools/index.js";
export { runTurn } from "./runtime.js";
export {
  createSession,
  loadSession,
  saveSession,
  listSessions,
  loadTurns,
  appendTurn,
  compactHistory,
} from "./session.js";
export { buildSystemPrompt } from "./system-prompt.js";
