/**
 * Agent turn orchestration.
 */

import { randomUUID } from "node:crypto";
import { autoCompactSessionHistory } from "./compact.js";
import { estimateTokenBudget } from "./context-budget.js";
import { resolveToolSandboxEnabled } from "./dangerous-tool-policy.js";
import {
  applyLiveTurnEvent,
  beginLiveTurnProgress,
  finishLiveTurnProgress,
} from "./live-turn-progress.js";
import { tryBuildModelConnectivityCheckReply } from "./model-connectivity-check.js";
import { tryBuildModelIdentityReply } from "./model-identity-reply.js";
import { filterToolsForPermissionMode, type AgentPermissionMode } from "./permission-mode.js";
import { createSession, loadSession } from "./session.js";
import type { ToolRegistry } from "./tools/registry.js";
import {
  bindTurnAbortSignal,
  clearTurnAbort,
  isTurnAbortRequested,
  requestTurnAbort,
} from "./turn-abort.js";
import type { RunTurnEvent } from "./turn-orchestrator-events.js";
export type { RunTurnEvent } from "./turn-orchestrator-events.js";
import type { MemoryContext } from "../memory/index.js";
import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import {
  cleanupFailedTurn,
  finalizeAgentTurn,
  finishShortCircuitTurn,
  type TurnFinalizeShared,
} from "./turn-orchestrator-finalize.js";
import { runModelToolLoop } from "./turn-orchestrator-model-loop.js";
import { prepareTurnPromptContext } from "./turn-orchestrator-prompt.js";
import {
  tryAutoDeliverableWorkflowShortcut,
  tryIntakeClarificationShortcut,
} from "./turn-orchestrator-shortcuts.js";
import type { AgentConfig, AgentContext, AgentTurn } from "./types.js";

const DEFAULT_MAX_TOOL_CALLS = 25;
const DEFAULT_MAX_HISTORY_MESSAGES = 100;
/** Used only when `AgentConfig.toolExecutionTimeoutMs` is unset — prefer model timeout. */
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

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
  /** Cooperative stop: checked between model rounds (Stop button). */
  shouldAbort?: () => boolean;
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
  const { memory, presetForTools, roleForTools, lawMindRoot } = await prepareTurnPromptContext({
    config,
    registry,
    session,
    instruction,
    resolvedAssistantId,
    linkedTaskIdForCtx,
    projectDirResolved,
    teamMeetingMode: opts.teamMeetingMode,
  });

  const toolSandboxEnabled = resolveToolSandboxEnabled(config.workspaceDir);

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

  const liveProgressKey = opts.liveProgressSessionId?.trim() || session.sessionId;
  clearTurnAbort(session.sessionId);
  const turnAbortSignal = bindTurnAbortSignal(session.sessionId);
  // Mirror shouldAbort (e.g. SSE disconnect) onto the AbortSignal so in-flight fetch cancels.
  const abortMirror = setInterval(() => {
    if (opts.shouldAbort?.() === true && !turnAbortSignal.aborted) {
      requestTurnAbort(session.sessionId);
    }
  }, 200);
  if (liveProgressKey) {
    beginLiveTurnProgress(liveProgressKey);
  }

  const abortRequested = (): boolean =>
    opts.shouldAbort?.() === true ||
    isTurnAbortRequested(session.sessionId) ||
    turnAbortSignal.aborted;

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
  const budgetOpts = {
    contextTokens: config.model.contextTokens ?? policyForCompact?.context?.contextTokens,
  };
  const tokenBudget = estimateTokenBudget(session, policyForCompact, budgetOpts);
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
    contextTokens: budgetOpts.contextTokens,
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

  const finishAbortedByUser = (): {
    turn: typeof turn;
    reply: string;
    sessionId: string;
    memoryContext: typeof memory;
  } => {
    clearTurnAbort(session.sessionId);
    turn.status = "error";
    turn.error = "aborted_by_user";
    // Match desktop Stop: drop this turn's user row when no assistant content yet.
    if (turn.messages.length === 0) {
      const last = session.conversationHistory[session.conversationHistory.length - 1];
      if (last?.role === "user" && last.content === instruction) {
        session.conversationHistory.pop();
      }
    }
    const reply = "已停止生成。";
    emitEvent({ type: "final", status: "error", reply });
    cleanupFailedTurn({
      workspaceDir: config.workspaceDir,
      session,
      turn,
      liveProgressKey,
      ensureLiveProgressFinished,
    });
    return {
      turn,
      reply,
      sessionId: session.sessionId,
      memoryContext: memory,
    };
  };

  const finalizeShared = (): TurnFinalizeShared => ({
    workspaceDir: config.workspaceDir,
    session,
    turn,
    emitEvent,
    sessionTitleHint,
    liveProgressKey,
    linkedTaskIdForCtx,
    memory,
    ensureLiveProgressFinished,
  });

  try {
    const modelIdentityReply = tryBuildModelIdentityReply(instruction, config.runtimeModel);
    if (modelIdentityReply) {
      return finishShortCircuitTurn(finalizeShared(), modelIdentityReply);
    }

    const connectivityReply = await tryBuildModelConnectivityCheckReply({
      instruction,
      identity: config.runtimeModel,
      modelConfig: config.model,
      lawMindRoot,
    });
    if (connectivityReply) {
      return finishShortCircuitTurn(finalizeShared(), connectivityReply);
    }

    const intakePolicy = readWorkspacePolicyFile(config.workspaceDir);
    const intakeResult = tryIntakeClarificationShortcut({
      instruction,
      session,
      turn,
      shared: finalizeShared(),
      actorId,
      resolvedAssistantId,
      modelName: config.model.model,
      caseMemory: memory.caseMemory,
      intakeHeuristicsEnabled: intakePolicy?.intakeHeuristicsEnabled,
    });
    if (intakeResult) {
      return intakeResult;
    }

    const autoWfResult = await tryAutoDeliverableWorkflowShortcut({
      instruction,
      session,
      ctx,
      shared: finalizeShared(),
      emitEvent,
      abortRequested,
      onAborted: finishAbortedByUser,
    });
    if (autoWfResult) {
      return autoWfResult;
    }

    const loop = await runModelToolLoop({
      config,
      registry,
      session,
      turn,
      ctx,
      openAITools,
      maxToolCalls,
      toolTimeoutMs,
      strictDangerousToolApproval,
      allowDangerousToolsWithoutApproval,
      toolSandboxEnabled,
      policyHints: {
        allowedToolNames: roleForTools?.allowedToolNames ?? presetForTools?.allowedToolNames,
        roleId: roleForTools?.roleId,
        riskCeiling: roleForTools?.riskCeiling ?? presetForTools?.riskCeiling,
      },
      actorId,
      hasOnEvent: Boolean(opts.onEvent),
      pendingClarificationQuestions: [],
      emitEvent,
      abortRequested,
      abortSignal: turnAbortSignal,
    });

    if (loop.aborted) {
      return finishAbortedByUser();
    }

    return finalizeAgentTurn({
      shared: finalizeShared(),
      finalReply: loop.finalReply,
      pendingClarificationQuestions: loop.pendingClarificationQuestions,
      turnUsage: loop.turnUsage,
      actorId,
      resolvedAssistantId,
      modelName: config.model.model,
    });
  } catch (err) {
    cleanupFailedTurn({
      workspaceDir: config.workspaceDir,
      session,
      turn,
      liveProgressKey,
      ensureLiveProgressFinished,
    });
    throw err;
  } finally {
    clearInterval(abortMirror);
    clearTurnAbort(session.sessionId);
  }
}
