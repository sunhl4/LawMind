/**
 * Agent turn orchestration.
 */

import { randomUUID } from "node:crypto";
import { resolveIntakeClarificationQuestions } from "../router/intake-gate.js";
import type { ClarificationQuestion } from "../types.js";
import { autoCompactSessionHistory } from "./compact.js";
import { estimateTokenBudget } from "./context-budget.js";
import { resolveToolSandboxEnabled } from "./dangerous-tool-policy.js";
import {
  formatDeliverableWorkflowReply,
  shouldAutoRunDeliverableWorkflow,
} from "./deliverable-pipeline.js";
import {
  applyLiveTurnEvent,
  beginLiveTurnProgress,
  finishLiveTurnProgress,
} from "./live-turn-progress.js";
import { tryBuildModelConnectivityCheckReply } from "./model-connectivity-check.js";
import { tryBuildModelIdentityReply } from "./model-identity-reply.js";
import { filterToolsForPermissionMode, type AgentPermissionMode } from "./permission-mode.js";
import { callModelWithRetry } from "./runtime-model-call.js";
import { createSession, loadSession, toModelMessages } from "./session.js";
import { executeWorkflow } from "./tools/engine-tools.js";
import type { ToolRegistry } from "./tools/registry.js";
import {
  buildClarificationReply,
  buildTurnReplyFallback,
  safeParse,
  type RunTurnEvent,
} from "./turn-orchestrator-events.js";
import {
  cleanupFailedTurn,
  finalizeAgentTurn,
  finishShortCircuitTurn,
  type TurnFinalizeShared,
} from "./turn-orchestrator-finalize.js";
export type { RunTurnEvent } from "./turn-orchestrator-events.js";
import type { MemoryContext } from "../memory/index.js";
import {
  mergeUsageSnapshots,
  usageFromProvider,
  type ModelUsageSnapshot,
} from "../models/model-usage.js";
import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import type { ToolCallRef } from "../runtime/tool-concurrency.js";
import { prepareTurnPromptContext } from "./turn-orchestrator-prompt.js";
import { executeToolBatches } from "./turn-orchestrator-tool-round.js";
import type { AgentConfig, AgentContext, AgentMessage, AgentTurn } from "./types.js";

const DEFAULT_MAX_TOOL_CALLS = 15;
const DEFAULT_MAX_HISTORY_MESSAGES = 50;
/** Used only when `AgentConfig.toolExecutionTimeoutMs` is unset (CLI/desktop should set via env). */
const DEFAULT_TOOL_TIMEOUT_MS = 30000;

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

  let finalReply = "";
  let pendingClarificationQuestions: ClarificationQuestion[] = [];

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

    // Intake-first: ask structured questions before heavy tools / auto workflow.
    const intakeQs = resolveIntakeClarificationQuestions(instruction);
    if (intakeQs.length > 0) {
      const reply = buildClarificationReply(
        "",
        intakeQs,
        "为少花几轮聊天、提高交件质量，请先确认以下要点（填完后我会继续执行）：",
      );
      const agentMsg: AgentMessage = {
        role: "assistant",
        content: reply,
        timestamp: new Date().toISOString(),
      };
      session.conversationHistory.push(agentMsg);
      turn.messages.push(agentMsg);
      turn.status = "awaiting_clarification";
      turn.clarificationQuestions = intakeQs;
      turn.gateDecisions?.push({
        gate: "intake_gate",
        decision: "awaiting_confirmation",
        reason: "开干前待澄清要点。",
      });
      return finalizeAgentTurn({
        shared: finalizeShared(),
        finalReply: reply,
        pendingClarificationQuestions: intakeQs,
        turnUsage: undefined,
        actorId,
        resolvedAssistantId,
        modelName: config.model.model,
      });
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
        return finishShortCircuitTurn(finalizeShared(), wfReply);
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
        agentMsg.toolCalls = toolCalls.map(
          (tc: { id: string; function: { name: string; arguments: string } }) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: safeParse(tc.function.arguments),
          }),
        );
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

      // 执行 tool calls — 通过 ToolPolicy pipeline（W2）；只读批可并发（见 turn-orchestrator-tool-round）
      const toolRefs: ToolCallRef[] = toolCalls.map(
        (tc: { id: string; function: { name: string; arguments: string } }) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: safeParse(tc.function.arguments),
        }),
      );
      const batchResult = await executeToolBatches({
        toolRefs,
        registry,
        turn,
        ctx,
        roundIndex,
        assistantContent: assistantMsg.content ?? "",
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
        sessionMatterId: session.matterId,
        sessionAssistantId: session.assistantId,
        pendingClarificationQuestions,
        emitEvent,
        pushMessage: (msg) => {
          session.conversationHistory.push(msg);
          turn.messages.push(msg);
        },
      });
      pendingClarificationQuestions = batchResult.pendingClarificationQuestions;
      if (batchResult.finalReply) {
        finalReply = batchResult.finalReply;
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

    return finalizeAgentTurn({
      shared: finalizeShared(),
      finalReply,
      pendingClarificationQuestions,
      turnUsage,
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
  }
}
