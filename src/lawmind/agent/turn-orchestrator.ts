/**
 * Agent turn orchestration.
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
import { callModelWithRetry } from "./runtime-model-call.js";
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
import {
  buildClarificationReply,
  buildTurnReplyFallback,
  collectRecentToolNamesFromSession,
  extractClarificationQuestions,
  extractToolErrorMessage,
  safeParse,
  type RunTurnEvent,
} from "./turn-orchestrator-events.js";
export type { RunTurnEvent } from "./turn-orchestrator-events.js";
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

      // 执行 tool calls — 通过 ToolPolicy pipeline（W2）；只读批可并发
      const toolRefs: ToolCallRef[] = toolCalls.map(
        (tc: { id: string; function: { name: string; arguments: string } }) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: safeParse(tc.function.arguments),
        }),
      );
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
