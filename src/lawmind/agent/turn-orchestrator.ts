/**
 * Agent turn orchestration.
 */

import { randomUUID } from "node:crypto";
import { attachEnabledMcpServers } from "../mcp/mcp-client-bridge.js";
import { hiddenPolicyToolNames } from "../policy/analysis-scripts.js";
import { applyCompactReinjectionToSession } from "./compact-reinjection.js";
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
import { type AgentPermissionMode } from "./permission-mode.js";
import { appendSessionEvent } from "./session-event-log.js";
import { isSessionPersistError } from "./session-persist.js";
import { withSessionTurnGate } from "./session-turn-gate.js";
import { appendTurn, createSession, loadSession, saveSession } from "./session.js";
import { mergeTurnDisclosedToolNames } from "./tools/disclosed-turn-tools.js";
import { resolveModelToolNames } from "./tools/governance.js";
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
import { extractSuggestedReplyTo } from "../platform/mail-contract-short-path-instruction.js";
import { isMailContractFastPathInstruction } from "../platform/mail-contract-short-path-instruction.js";
import { resolvePlaybookToolLock } from "../platform/playbook-tool-lock.js";
import { buildRequiresActionsFromTurn } from "../platform/requires-action.js";
import { isWordRevisionTurn } from "../platform/word-revision-instruction.js";
import {
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
} from "../policy/workspace-policy.js";
import { ensureLawyerWorkForTurn } from "../work/goal.js";
import { intersectAllowedToolNames } from "./child-gates.js";
import { resolveToolCallBudgets } from "./tool-budget.js";
import {
  cleanupFailedTurn,
  finalizeAgentTurn,
  finishShortCircuitTurn,
  type TurnFinalizeShared,
} from "./turn-orchestrator-finalize.js";
import { runModelToolLoop } from "./turn-orchestrator-model-loop.js";
import { prepareTurnPromptContext, resolveAssistantTooling } from "./turn-orchestrator-prompt.js";
import {
  tryAutoDeliverableWorkflowShortcut,
  tryIntakeClarificationShortcut,
} from "./turn-orchestrator-shortcuts.js";
import { freezeTurnContext } from "./turn-step-context.js";
import type { AgentConfig, AgentContext, AgentTurn } from "./types.js";

const DEFAULT_MAX_TOOL_CALLS = 40;
const DEFAULT_MAX_HISTORY_MESSAGES = 100;
/** Used only when `AgentConfig.toolExecutionTimeoutMs` is unset — 0 = no wall-clock tool kill. */
const DEFAULT_TOOL_TIMEOUT_MS = 0;

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
  /** 模板级预批准（协作 executor 白名单过滤后的工具名列表）。 */
  preApproveToolNames?: string[];
  permissionMode?: AgentPermissionMode;
  /** Structured compose `@` pins from desktop chat. */
  contextPins?: import("../platform/compose-context-pin.js").ComposeContextPin[];
  /** Internal: caller already holds `withSessionTurnGate` (resume paths). */
  skipSessionTurnGate?: boolean;
  /** Lawyer already approved a continue_tools checkpoint this thread. */
  skipToolBudgetCheckpoint?: boolean;
  /** Resume from a checkpoint: keep the prior tool-call count (hard ceiling stays cumulative). */
  initialToolCallsExecuted?: number;
}): Promise<{ turn: AgentTurn; reply: string; sessionId: string; memoryContext: MemoryContext }> {
  const existingSessionId = opts.sessionId?.trim();
  if (existingSessionId && !opts.skipSessionTurnGate) {
    return withSessionTurnGate(opts.config.workspaceDir, existingSessionId, () =>
      runTurn({ ...opts, skipSessionTurnGate: true }),
    );
  }
  const { config, registry, instruction, matterId, sessionTitleHint } = opts;
  let mcpSessions: Awaited<ReturnType<typeof attachEnabledMcpServers>>["sessions"] = [];
  try {
    const attached = await attachEnabledMcpServers({ registry, workspaceDir: config.workspaceDir });
    mcpSessions = attached.sessions;
  } catch {
    /* MCP must not break the core tool table */
  }
  const linkedTaskIdForCtx =
    typeof opts.linkedTaskId === "string" && opts.linkedTaskId.trim()
      ? opts.linkedTaskId.trim()
      : undefined;
  const projectDirResolved = (opts.projectDir ?? config.projectDir)?.trim() || undefined;
  const toolBudgets = resolveToolCallBudgets(config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS);
  const maxToolCalls = toolBudgets.soft;
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

  try {
    ensureLawyerWorkForTurn({
      workspaceDir: config.workspaceDir,
      sessionId: session.sessionId,
      instruction,
      matterId: session.matterId,
      source: /文件页|file chat|read_project_file/i.test(instruction) ? "file" : "chat",
    });
  } catch {
    /* overlay is best-effort */
  }

  // D8: keep pendingClarificationKeys across the turn so the prompt can list them;
  // finalize clears or refreshes when the turn ends.

  const turnId = randomUUID();
  const startedAt = new Date().toISOString();

  const resolvedAssistantId = config.assistantId ?? session.assistantId;
  const historyText = session.conversationHistory
    .slice(-8)
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
  const wordRevisionTurn = isWordRevisionTurn({
    instruction,
    pins: opts.contextPins,
    historyText,
  });
  const mailContractTurn = isMailContractFastPathInstruction(instruction);

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
    // 跨轮澄清硬门禁：上一轮以 awaiting_clarification 结束时，本轮默认拦截
    // 起草/工作流/渲染等重工具；结构化 resume（律师逐条作答）在 runtime-resume
    // 中显式清键放行；普通新消息若未再提出澄清，finalize 清键后下一轮放行。
    clarificationBlockingHeavyTools: (session.pendingClarificationKeys?.length ?? 0) > 0,
    strictDangerousToolApproval,
    preApproveToolName: opts.preApproveToolName?.trim() || undefined,
    preApproveToolArgs: opts.preApproveToolArgs,
    preApproveToolNames:
      opts.preApproveToolNames && opts.preApproveToolNames.length > 0
        ? [...opts.preApproveToolNames]
        : undefined,
    contextPins: opts.contextPins,
    outboundPinnedTo: extractSuggestedReplyTo(instruction),
    wordRevisionTurn,
    mailContractTurn,
  };

  // 2. 先定本轮生效工具集：W7 Role.allowedToolNames 优先，回退 preset；
  //    parent inherit（child-gates）只缩不扩；高频 playbook 再锁死路径工具表；
  //    最后经权限模式与隐藏策略过滤。system prompt 的工具目录与发给模型的
  //    tools 都由这一份清单生成（单一真相源），执行层另有 permissionModeMiddleware 硬拦。
  const assistantTooling = resolveAssistantTooling({
    workspaceDir: config.workspaceDir,
    resolvedAssistantId,
  });
  const { presetForTools, roleForTools } = assistantTooling;
  const playbookLock = resolvePlaybookToolLock(instruction, opts.contextPins);
  const allowNamesRaw = intersectAllowedToolNames(
    intersectAllowedToolNames(
      config.allowedToolNames,
      roleForTools?.allowedToolNames ?? presetForTools?.allowedToolNames,
    ),
    playbookLock?.allowNames,
  );
  const lockToAllowNames = Boolean(playbookLock);
  const hiddenTools = hiddenPolicyToolNames(config.workspaceDir);
  session.disclosedToolNames = mergeTurnDisclosedToolNames({
    session,
    workspaceDir: config.workspaceDir,
    pins: opts.contextPins,
    registry,
    hiddenNames: hiddenTools,
    instruction,
  });
  const modelToolNames = resolveModelToolNames({
    registeredNames: registry.listDefinitions().map((def) => def.name),
    allowNames: allowNamesRaw,
    permissionMode,
    disclosedNames: session.disclosedToolNames,
    lockToAllowNames,
  }).filter((name) => !hiddenTools.includes(name));

  // 3. 构建 system prompt（「可用工具」一节 = 本轮生效工具集）
  const { memory, lawMindRoot } = await prepareTurnPromptContext({
    config,
    registry,
    session,
    instruction,
    resolvedAssistantId,
    linkedTaskIdForCtx,
    projectDirResolved,
    teamMeetingMode: opts.teamMeetingMode,
    contextPins: opts.contextPins,
    permissionMode,
    assistantTooling,
    availableToolNames: modelToolNames,
  });

  const toolSandboxEnabled =
    config.toolSandboxEnabled === true || resolveToolSandboxEnabled(config.workspaceDir);

  // 4. 添加用户消息
  session.conversationHistory.push({
    role: "user",
    content: instruction,
    timestamp: new Date().toISOString(),
  });

  ctx.allowedToolNames = allowNamesRaw;
  ctx.toolSandboxEnabled = toolSandboxEnabled;
  const openAITools = registry.toOpenAITools({ names: modelToolNames });
  const turnContext = freezeTurnContext({
    sessionId: session.sessionId,
    turnId,
    permissionMode,
    matterId: session.matterId,
    model: config.model.model,
    actorId,
    sandboxEnabled: toolSandboxEnabled,
    allowNames: allowNamesRaw,
    lockToAllowNames,
    wordRevisionTurn,
    hiddenToolNames: hiddenTools,
  });
  ctx.permissionMode = turnContext.permissionMode;
  const priorUsed = opts.initialToolCallsExecuted;
  const seededToolCalls =
    typeof priorUsed === "number" && Number.isFinite(priorUsed) && priorUsed > 0
      ? Math.floor(priorUsed)
      : 0;
  const turn: AgentTurn = {
    turnId,
    sessionId: session.sessionId,
    instruction,
    messages: [],
    toolCallsExecuted: seededToolCalls,
    status: "running",
    gateDecisions: [],
    startedAt,
  };

  const liveProgressKey = opts.liveProgressSessionId?.trim() || session.sessionId;
  clearTurnAbort(session.sessionId);
  const turnAbortSignal = bindTurnAbortSignal(session.sessionId);
  ctx.abortSignal = turnAbortSignal;
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
    appendSessionEvent(config.workspaceDir, session.sessionId, event, { turnId });
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

  let liveProgressFinished = false;
  const ensureLiveProgressFinished = (status: "completed" | "failed"): void => {
    if (!liveProgressKey || liveProgressFinished) {
      return;
    }
    liveProgressFinished = true;
    finishLiveTurnProgress(liveProgressKey, status);
  };

  try {
    appendSessionEvent(config.workspaceDir, session.sessionId, { type: "turn_begin" }, { turnId });

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
      session.needsCompactReinjection = true;
      // Same-turn reinjection: prepare already ran; patch system message before model loop.
      const mandatory = resolveAgentMandatoryRulesForPrompt(config.workspaceDir, policyForCompact);
      applyCompactReinjectionToSession(session, { mandatoryRulesActive: mandatory.active });
      emitEvent({
        type: "compact_boundary",
        sessionSummaryPath: compactResult.sessionSummaryPath,
        droppedMessageCount: compactResult.droppedMessageCount,
      });
    }

    const finishAbortedByUser = (): {
      turn: typeof turn;
      reply: string;
      sessionId: string;
      memoryContext: typeof memory;
    } => {
      clearTurnAbort(session.sessionId);
      const hasProgress = turn.toolCallsExecuted > 0 || turn.messages.length > 0;

      // Soft stop with progress → checkpoint (paused) so lawyer can resume.
      if (hasProgress) {
        turn.status = "paused";
        turn.error = undefined;
        const reply = `已暂停（已完成 ${turn.toolCallsExecuted} 次工具调用）。可「继续」从检查点接着做，或发送新指令。`;
        turn.result = reply;
        turn.completedAt = new Date().toISOString();
        const agentMsg = {
          role: "assistant" as const,
          content: reply,
          timestamp: new Date().toISOString(),
        };
        session.conversationHistory.push(agentMsg);
        turn.messages.push(agentMsg);
        turn.requiresAction = buildRequiresActionsFromTurn({
          status: turn.status,
          clarificationQuestions: turn.clarificationQuestions,
          turnId: turn.turnId,
          sessionId: turn.sessionId,
          toolCallsExecuted: turn.toolCallsExecuted,
          matterId: session.matterId,
          pendingToolApproval: turn.pendingToolApproval,
        });
        if (turn.requiresAction.length > 0) {
          session.pendingRequiresAction = turn.requiresAction;
        }
        session.turns.push({ ...turn });
        try {
          appendTurn(config.workspaceDir, turn);
        } catch {
          /* ignore disk */
        }
        emitEvent({ type: "final", status: "paused", reply });
        ensureLiveProgressFinished("failed");
        try {
          saveSession(config.workspaceDir, session);
        } catch {
          /* ignore */
        }
        return {
          turn,
          reply,
          sessionId: session.sessionId,
          memoryContext: memory,
        };
      }

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
      hasContextPins: Array.isArray(opts.contextPins) && opts.contextPins.length > 0,
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
      turn,
      registry,
      shared: finalizeShared(),
      emitEvent,
      abortRequested,
      onAborted: finishAbortedByUser,
      autoDeliverableWorkflow: intakePolicy?.autoDeliverableWorkflow,
      actorId,
      maxToolCalls,
      toolTimeoutMs,
      strictDangerousToolApproval,
      allowDangerousToolsWithoutApproval,
      toolSandboxEnabled,
      allowedToolNames: roleForTools?.allowedToolNames ?? presetForTools?.allowedToolNames,
      roleId: roleForTools?.roleId,
      riskCeiling: roleForTools?.riskCeiling ?? presetForTools?.riskCeiling,
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
      turnContext,
      maxToolCalls,
      hardToolCallCeiling: toolBudgets.hard,
      skipToolBudgetCheckpoint: opts.skipToolBudgetCheckpoint === true,
      toolTimeoutMs,
      strictDangerousToolApproval,
      allowDangerousToolsWithoutApproval,
      toolSandboxEnabled,
      policyHints: {
        allowedToolNames: lockToAllowNames
          ? allowNamesRaw
          : (roleForTools?.allowedToolNames ?? presetForTools?.allowedToolNames),
        allowlistDenyHint: playbookLock?.denyHint,
        roleId: roleForTools?.roleId,
        riskCeiling: roleForTools?.riskCeiling ?? presetForTools?.riskCeiling,
        autoApproveSandboxWorkflowSteps: config.autoApproveSandboxWorkflowSteps === true,
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

    let finalReply = loop.finalReply;
    // 软预算检查点暂停（paused）时 turn 未完，不做 Word 改稿自动交付。
    if (turn.status !== "paused") {
      try {
        const { autoDeliverWordRevisionIfNeeded } = await import("./word-revision-auto-deliver.js");
        const delivered = await autoDeliverWordRevisionIfNeeded({
          ctx,
          registry,
          turn,
        });
        if (delivered) {
          finalReply = [finalReply, delivered].filter((s) => s?.trim()).join("\n\n");
        }
      } catch {
        /* delivery is best-effort; the model path already ran */
      }
    }

    return finalizeAgentTurn({
      shared: finalizeShared(),
      finalReply,
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
    if (isSessionPersistError(err)) {
      turn.status = "error";
      turn.error = err.message;
      return {
        turn,
        reply: err.message,
        sessionId: session.sessionId,
        memoryContext: memory,
      };
    }
    throw err;
  } finally {
    clearInterval(abortMirror);
    clearTurnAbort(session.sessionId);
    await Promise.all(mcpSessions.map((s) => s.close().catch(() => undefined)));
  }
}
