/**
 * LawMind Agent factory — createLawMindAgent and LawMindAgent type.
 *
 * Kept separate from `index.ts` so collaboration/message-bus can import
 * without circular dependency through the barrel.
 */

import type { MemoryContext } from "../memory/index.js";
import {
  listDelegations,
  readCollaborationEvents,
  restoreDelegationsFromDisk,
} from "./collaboration/index.js";
import type { DelegationRecord, CollaborationEvent } from "./collaboration/types.js";
import { runTurn, type RunTurnEvent } from "./runtime.js";
import { createSession, listSessions, loadSession, loadTurns } from "./session.js";
import { ToolRegistry, createLegalToolRegistry } from "./tools/index.js";
import type { AgentConfig, AgentSession, AgentTurn, ToolDefinition } from "./types.js";

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
      /** 桌面端选中的项目目录（本机绝对路径） */
      projectDir?: string;
      /** 本轮是否允许 web_search（覆盖 AgentConfig） */
      allowWebSearch?: boolean;
      /** 团队会议室：收紧 system prompt 中的答复与协作约束 */
      teamMeetingMode?: boolean;
      /** 自动会话标题：输入框原文（不含前缀），用于取提问前几个字命名 */
      sessionTitleHint?: string;
      /** 审核台/工作台关联的草稿 taskId，供引擎工具作隐式默认 */
      linkedTaskId?: string;
      /** 流式进度回调（最终轮 LLM 增量内容通过 `delta` 事件推送）。 */
      onEvent?: (event: RunTurnEvent) => void;
      /** 供后台任务轮询 GET /api/sessions/:id/live-turn */
      liveProgressSessionId?: string;
    },
  ) => Promise<{
    reply: string;
    sessionId: string;
    turn: AgentTurn;
    memoryContext: MemoryContext;
  }>;

  /** 创建新对话 */
  newSession: (opts?: { matterId?: string; title?: string }) => AgentSession;

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

  /** 列出委派任务（助手间协作） */
  listDelegations: (opts?: { status?: string }) => DelegationRecord[];

  /** 读取协作审计事件 */
  getCollaborationEvents: () => CollaborationEvent[];
};

export function createLawMindAgent(config: AgentConfig): LawMindAgent {
  const actorId =
    config.actorId ?? (config.assistantId ? `assistant:${config.assistantId}` : "lawyer");

  const defaultRegistry = () =>
    createLegalToolRegistry({
      allowWebSearch: config.allowWebSearch === true,
      enableCollaboration: config.enableCollaboration === true,
      baseConfig: config.enableCollaboration ? config : undefined,
    });

  if (config.enableCollaboration) {
    restoreDelegationsFromDisk(config.workspaceDir);
  }

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
        enableCollaboration: mergedConfig.enableCollaboration === true,
        baseConfig: mergedConfig.enableCollaboration ? mergedConfig : undefined,
      });
      const result = await runTurn({
        config: mergedConfig,
        registry,
        sessionId: opts?.sessionId,
        instruction,
        sessionTitleHint: opts?.sessionTitleHint,
        matterId: opts?.matterId,
        linkedTaskId: opts?.linkedTaskId,
        projectDir: opts?.projectDir,
        teamMeetingMode: opts?.teamMeetingMode === true,
        onEvent: opts?.onEvent,
        liveProgressSessionId: opts?.liveProgressSessionId,
      });

      return {
        reply: result.reply,
        sessionId: result.sessionId,
        turn: result.turn,
        memoryContext: result.memoryContext,
      };
    },

    newSession(opts) {
      return createSession({
        workspaceDir: config.workspaceDir,
        matterId: opts?.matterId,
        actorId,
        assistantId: config.assistantId,
        title: opts?.title,
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

    listDelegations(opts) {
      return listDelegations({
        fromAssistantId: config.assistantId,
        status: opts?.status as "pending" | "running" | "completed" | "failed" | undefined,
      });
    },

    getCollaborationEvents() {
      return readCollaborationEvents(config.workspaceDir);
    },
  };
}
