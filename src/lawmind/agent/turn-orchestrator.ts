/**
 * Agent turn orchestration.
 */

import { randomUUID } from "node:crypto";
import { resolveLiveSessionMatterId } from "../desk/deleted-matters.js";
import { attachEnabledMcpServers } from "../mcp/mcp-client-bridge.js";
import { hiddenPolicyToolNames } from "../policy/analysis-scripts.js";
import { withAssistantTurnGate } from "./assistant-turn-gate.js";
import { accumulateFactPin } from "./compact-fact-pin.js";
import { applyCompactReinjectionToSession, selectTaskPinText } from "./compact-reinjection.js";
import { autoCompactSessionHistory } from "./compact.js";
import { estimateTokenBudget } from "./context-budget.js";
import { isolationKey, resetIsolationBudget } from "./context-isolation-budget.js";
import { resolveContextTuning } from "./context-tuning.js";
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
import {
  appendTurn,
  createSession,
  loadSession,
  saveSession,
  upsertSessionTurn,
} from "./session.js";
import { mergeTurnDisclosedToolNames, pinsIncludeDirectory } from "./tools/disclosed-turn-tools.js";
import { resolveModelToolNames } from "./tools/governance.js";
import { pickWebSearchModel } from "./tools/lawmind-web-search.js";
import type { ToolRegistry } from "./tools/registry.js";
import {
  bindTurnAbortSignal,
  clearTurnAbort,
  isTurnAbortRequested,
  requestTurnAbort,
} from "./turn-abort.js";
import { emitTurnLifecycle } from "./turn-lifecycle-hooks.js";
import type { RunTurnEvent } from "./turn-orchestrator-events.js";
import { pruneTurnPlanForNewInstruction, withUpdatePlanControlTool } from "./turn-plan.js";
export type { RunTurnEvent } from "./turn-orchestrator-events.js";
import { resolveLawMindRoot } from "../assistants/store.js";
import { compileIntent, compiledIntentPlanItems } from "../intent/compile-intent.js";
import { resolveTurnDeliveryIntent } from "../intent/delivery-intent.js";
import { loadMatterKindForIntent, peekPinnedDocuments } from "../intent/peek-pinned-documents.js";
import { compiledIntentInjectsSkillBodies } from "../intent/understand-first.js";
import {
  isCorrectionUtterance,
  isNoTaskUtterance,
  isTaskSwitchUtterance,
  shouldRequireFolderExplore,
} from "../intent/utterance-kind.js";
import type { MemoryContext } from "../memory/index.js";
import { isContractFastLaneInstruction } from "../platform/contract-fast-lane-instruction.js";
import { extractSuggestedReplyTo } from "../platform/mail-contract-short-path-instruction.js";
import { isMailContractFastPathInstruction } from "../platform/mail-contract-short-path-instruction.js";
import { resolvePlaybookToolLock } from "../platform/playbook-tool-lock.js";
import { buildRequiresActionsFromTurn } from "../platform/requires-action.js";
import { isWordRevisionTurn } from "../platform/word-revision-instruction.js";
import {
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
} from "../policy/workspace-policy.js";
import { selectHardClarificationKeys } from "../router/intake-gate.js";
import {
  noteLawyerIcloudReply,
  runApprovedIcloudDownloads,
} from "../runtime/icloud-materialize.js";
import { contextUsesHostFileLedger } from "../runtime/tool-pipeline.js";
import { DEFAULT_TOOL_WALL_TIMEOUT_MS } from "../runtime/tool-timeout-env.js";
import { deskItemById } from "../skills/lawyer-capability-lock.js";
import { ensureLawyerWorkForTurn } from "../work/goal.js";
import { intersectAllowedToolNames } from "./child-gates.js";
import { mergeConfirmedAnswers } from "./confirmed-answers.js";
import { resolveToolCallBudgets, DEFAULT_SOFT_TOOL_CALLS } from "./tool-budget.js";
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
  tryPublicWebFactShortcut,
} from "./turn-orchestrator-shortcuts.js";
import { freezeTurnContext } from "./turn-step-context.js";
import type { AgentConfig, AgentContext, AgentTurn } from "./types.js";

const DEFAULT_MAX_HISTORY_MESSAGES = 100;
/** Used only when `AgentConfig.toolExecutionTimeoutMs` is unset. */
const DEFAULT_TOOL_TIMEOUT_MS = DEFAULT_TOOL_WALL_TIMEOUT_MS;

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
  /** Internal: caller already holds `withAssistantTurnGate` (resume paths). */
  skipAssistantTurnGate?: boolean;
  /** Kept for resume of already-paused continue_tools cards; new turns never checkpoint. */
  skipToolBudgetCheckpoint?: boolean;
  /** Resume from a checkpoint: keep the prior tool-call count (hard ceiling stays cumulative). */
  initialToolCallsExecuted?: number;
  /** Lawyer-confirmed clarification answers for Guardian evidence this turn. */
  confirmedAnswers?: Record<string, string>;
}): Promise<{ turn: AgentTurn; reply: string; sessionId: string; memoryContext: MemoryContext }> {
  if (!opts.skipAssistantTurnGate) {
    const fromConfig = opts.config.assistantId?.trim();
    let assistantId = fromConfig || "";
    if (!assistantId) {
      const sid = opts.sessionId?.trim();
      if (sid) {
        const existing = loadSession(opts.config.workspaceDir, sid);
        assistantId = existing?.assistantId?.trim() || "";
      }
    }
    return withAssistantTurnGate(opts.config.workspaceDir, assistantId || "default", () =>
      runTurn({ ...opts, skipAssistantTurnGate: true }),
    );
  }
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
  const toolBudgets = resolveToolCallBudgets(config.maxToolCalls ?? DEFAULT_SOFT_TOOL_CALLS);
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
  resetIsolationBudget(isolationKey(config.workspaceDir, session.sessionId));

  // 律师在工作台切「用于对话」的案件后，本回合显式带来的 matterId 才是本案。
  // 早期「首次为空才写」的写法会让旧会话永远钉在第一个案件上：之后
  // import_host_file 的默认 matter_id、期限/卷宗/谈话写笔、记忆与提示词里的
  // 当前案件全部落在旧案（真实事故：新建案件后收材料进上一案 materials/）。
  // 已删除且目录不在的编号不再钉住，避免下一句又把空壳建回来。
  const liveMatterId = resolveLiveSessionMatterId(config.workspaceDir, session.matterId, matterId);
  if (liveMatterId) {
    session.matterId = liveMatterId;
  } else if (session.matterId) {
    delete session.matterId;
  }
  session.turnPlan = pruneTurnPlanForNewInstruction(session.turnPlan, instruction);
  noteLawyerIcloudReply(instruction);

  // 上下文调参（预算 / 压缩 / 摘要 / 钉子 / 续接）从 policy 解析一次，本回合复用；
  // 非法或越界的值已在 `resolveContextTuning` 里被回落 / 夹取，这里拿到的一定可用。
  const workspacePolicy = readWorkspacePolicyFile(config.workspaceDir);
  const contextTuning = resolveContextTuning(workspacePolicy);

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
  const deliveryIntent = resolveTurnDeliveryIntent(instruction, opts.contextPins);
  const mailContractTurn = isMailContractFastPathInstruction(instruction);
  const contractFastLaneTurn = isContractFastLaneInstruction(instruction);
  const confirmedAnswers = mergeConfirmedAnswers(
    session.lastConfirmedAnswers,
    opts.confirmedAnswers,
  );
  if (confirmedAnswers) {
    session.lastConfirmedAnswers = confirmedAnswers;
  }

  // Codex 对齐：单字 / 纯确认 / 空回合没有新任务。恢复类入口（预批准、
  // 检查点续作）自带指令，不算无任务回合。
  const noTaskTurn =
    isNoTaskUtterance(instruction) &&
    !opts.preApproveToolName &&
    !(opts.preApproveToolNames && opts.preApproveToolNames.length > 0) &&
    !/【从检查点继续】/.test(instruction);
  // ── 任务锚点（钉子）──────────────────────────────────────────────
  // 首次确定后**持久化**，此后跨任意次压缩原样存活（写进重注块 → 落到 system[0]）。
  // 换任务时更新：否则长会话里钉着一个早已做完的目标，反而误导。
  // 无任务回合（单字 / 纯确认）不动钉子。
  {
    const pinText = selectTaskPinText(instruction, contextTuning.pins.taskCharCap);
    const shouldPin =
      Boolean(pinText) &&
      !noTaskTurn &&
      (!session.taskPin?.text || isTaskSwitchUtterance(instruction));
    if (shouldPin && pinText) {
      session.taskPin = {
        text: pinText,
        at: new Date().toISOString(),
      };
    }
    // 事实台账与任务钉子同处抽取：律师自己说的期限 / 硬约束 / 引用 / 金额，
    // **收到即钉**，不必等到压缩那一刻（那一刻它可能已经离开要点窗口了）。
    accumulateFactPin(
      session,
      [{ role: "user", content: instruction, timestamp: "" }],
      contextTuning.pins,
    );
  }

  const ctx: AgentContext = {
    workspaceDir: config.workspaceDir,
    sessionId: session.sessionId,
    matterId: session.matterId,
    actorId,
    assistantId: resolvedAssistantId,
    projectDir: projectDirResolved,
    hostAccessFile: process.env.LAWMIND_HOST_ACCESS_FILE?.trim() || undefined,
    linkedTaskId: linkedTaskIdForCtx,
    allowWebSearch: config.allowWebSearch === true,
    webSearchModel:
      pickWebSearchModel(
        config.model.apiKey
          ? {
              baseUrl: config.model.baseUrl,
              apiKey: config.model.apiKey,
              model: config.model.model,
              timeoutMs: config.model.timeoutMs,
            }
          : null,
        resolveLawMindRoot(config.workspaceDir, config.envFile),
      ) ?? undefined,
    permissionMode,
    collaborationEnabled: config.enableCollaboration === true,
    envFile: config.envFile,
    // 跨轮澄清硬门禁：上一轮以 awaiting_clarification 结束时，本轮默认拦截
    // 起草/工作流/渲染等重工具；结构化 resume（律师逐条作答）在 runtime-resume
    // 中显式清键放行；普通新消息若未再提出澄清，finalize 清键后下一轮放行。
    clarificationBlockingHeavyTools:
      selectHardClarificationKeys(session.pendingClarificationKeys).length > 0,
    noTaskTurn,
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
    deliveryIntent,
    mailContractTurn,
    folderExploreRequired: shouldRequireFolderExplore({
      instruction,
      hasDirectoryPin: pinsIncludeDirectory(opts.contextPins),
      wordRevisionTurn,
      mailContractTurn,
    }),
    contractFastLaneTurn,
    chatModel: config.model,
    reviewModel: config.workerModel ?? config.model,
    ...(confirmedAnswers ? { confirmedAnswers } : {}),
  };

  // 2. 先定本轮生效工具集：W7 Role.allowedToolNames 优先，回退 preset；
  //    parent inherit（child-gates）只缩不扩；高频 playbook 只加 deny-list
  //    （误发 / 模板重建），不冻结整张工具表；
  //    最后经权限模式与隐藏策略过滤。system prompt 的工具目录与发给模型的
  //    tools 都由这一份清单生成（单一真相源），执行层另有 permissionModeMiddleware 硬拦。
  const assistantTooling = resolveAssistantTooling({
    workspaceDir: config.workspaceDir,
    resolvedAssistantId,
  });
  const { presetForTools, roleForTools } = assistantTooling;
  const playbookLock = resolvePlaybookToolLock(instruction, opts.contextPins);
  const documentPeeks = await peekPinnedDocuments({
    workspaceDir: config.workspaceDir,
    projectDir: projectDirResolved,
    pins: opts.contextPins,
  }).catch(() => []);
  const previousCapabilityId = session.lastBoundCapabilityId;
  const compiledIntent = compileIntent({
    instruction,
    pins: opts.contextPins,
    documents: documentPeeks,
    matterKind: loadMatterKindForIntent(config.workspaceDir, session.matterId),
    previousCapabilityId,
    historyText,
    mailFastPath: mailContractTurn,
  });
  if (compiledIntent.capabilityId && compiledIntentInjectsSkillBodies(compiledIntent)) {
    session.lastBoundCapabilityId = compiledIntent.capabilityId;
  } else {
    delete session.lastBoundCapabilityId;
  }
  if (
    !wordRevisionTurn &&
    !mailContractTurn &&
    (compiledIntent.capabilityId === "contract.review" ||
      compiledIntent.capabilityId === "research.memo" ||
      deliveryIntent.artifactShape === "opinion_memo")
  ) {
    ctx.sidecarRole = "review";
  }
  if (
    session.turnPlan &&
    (isTaskSwitchUtterance(instruction) ||
      isCorrectionUtterance(instruction) ||
      (previousCapabilityId &&
        compiledIntent.capabilityId &&
        compiledIntent.capabilityId !== previousCapabilityId))
  ) {
    session.turnPlan = undefined;
  }
  const chainPlanSteps = compiledIntentPlanItems(compiledIntent);
  if (chainPlanSteps.length >= 2 && !session.turnPlan) {
    session.turnPlan = {
      items: chainPlanSteps.map((step, index) => ({
        step,
        status: index === 0 ? "in_progress" : "pending",
      })),
      explanation: "按材料自动组合",
      updatedAt: new Date().toISOString(),
    };
  }
  const allowNamesRaw = intersectAllowedToolNames(
    config.allowedToolNames,
    roleForTools?.allowedToolNames ?? presetForTools?.allowedToolNames,
  );
  const denyNames = playbookLock?.denyNames;
  const registeredNames = registry.listDefinitions().map((def) => def.name);
  const allowNamesForExec = withUpdatePlanControlTool(allowNamesRaw, registeredNames);
  const hiddenTools = hiddenPolicyToolNames(config.workspaceDir);
  session.disclosedToolNames = mergeTurnDisclosedToolNames({
    session,
    workspaceDir: config.workspaceDir,
    pins: opts.contextPins,
    registry,
    hiddenNames: hiddenTools,
    instruction,
    projectDir: projectDirResolved,
    documents: documentPeeks,
    matterKind: loadMatterKindForIntent(config.workspaceDir, session.matterId),
    previousCapabilityId,
    matterId: session.matterId,
  });
  // Codex 对齐：无任务回合把工具表收成只读（与 permissionModeMiddleware 同一份名单），
  // 运行期另有 noTaskTurnGateMiddleware 硬拒写类工具。
  const toolTablePermissionMode = noTaskTurn ? "readonly" : permissionMode;
  const modelToolNames = resolveModelToolNames({
    registeredNames: registry.listDefinitions().map((def) => def.name),
    allowNames: allowNamesRaw,
    permissionMode: toolTablePermissionMode,
    disclosedNames: session.disclosedToolNames,
    denyNames,
  }).filter((name) => !hiddenTools.includes(name));
  // 注：`resolveModelToolNames` 总会兜底补 update_plan（每轮 rebuild 也会补），
  // 所以无任务回合不收广告；改由 noTaskTurnGateMiddleware 在调用点拒绝。

  // 3. 构建 system prompt（「可用工具」一节 = 本轮生效工具集）
  const { memory, lawMindRoot } = await prepareTurnPromptContext({
    config,
    registry,
    session,
    instruction,
    resolvedAssistantId,
    linkedTaskIdForCtx,
    projectDirResolved,
    contextPins: opts.contextPins,
    permissionMode: toolTablePermissionMode,
    assistantTooling,
    availableToolNames: modelToolNames,
    compiledIntent,
    noTaskTurn,
  });

  const toolSandboxEnabled =
    config.toolSandboxEnabled === true || resolveToolSandboxEnabled(config.workspaceDir);

  // 4. 添加用户消息（原样入史，不得改写成另一句 prompt）。
  // 组装期间已经点了停止：不落这句，避免停完还在历史里。
  const stoppedDuringSetup =
    opts.shouldAbort?.() === true || isTurnAbortRequested(session.sessionId);
  if (!stoppedDuringSetup) {
    const typed = sessionTitleHint?.trim();
    session.conversationHistory.push({
      role: "user",
      content: instruction,
      timestamp: new Date().toISOString(),
      ...(typed && typed !== instruction.trim() ? { lawyerVisibleText: typed } : {}),
      // 续跑说明给模型看。律师已经点过继续，气泡里不再出现这句内部交代。
      ...(instruction.includes("【从检查点继续】") ? { hiddenFromLawyer: true } : {}),
    });
  }

  ctx.allowedToolNames = allowNamesForExec;
  ctx.toolSandboxEnabled = toolSandboxEnabled;
  const openAITools = registry.toOpenAITools({ names: modelToolNames });
  const turnContext = freezeTurnContext({
    sessionId: session.sessionId,
    turnId,
    permissionMode: toolTablePermissionMode,
    matterId: session.matterId,
    model: config.model.model,
    actorId,
    sandboxEnabled: toolSandboxEnabled,
    allowNames: allowNamesForExec,
    denyNames,
    wordRevisionTurn,
    hostFileLedger: contextUsesHostFileLedger(ctx),
    contextTokens: config.model.contextTokens,
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
  // Codex 对齐：回合开始就落盘占位轮次。否则中途退出/被杀会留下「有历史、无轮次」
  // 的会话，下一句单字就会被当成新任务顺着旧上下文重跑（真实事故）。
  if (!stoppedDuringSetup) {
    try {
      upsertSessionTurn(session, {
        turnId: turn.turnId,
        sessionId: turn.sessionId,
        instruction: turn.instruction,
        messages: [],
        toolCallsExecuted: turn.toolCallsExecuted,
        status: turn.status,
        startedAt: turn.startedAt,
      });
      saveSession(config.workspaceDir, session);
    } catch {
      /* 占位失败不阻塞本轮；中断判定退化为「无轮次」 */
    }
  }

  const liveProgressKey = opts.liveProgressSessionId?.trim() || session.sessionId;
  // Do not clear a Stop that arrived during MCP / peek / prompt assembly.
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
    if (abortRequested()) {
      clearTurnAbort(session.sessionId);
      if (turn.messages.length === 0) {
        const last = session.conversationHistory[session.conversationHistory.length - 1];
        if (last?.role === "user" && last.content === instruction) {
          session.conversationHistory.pop();
        }
      }
      turn.status = "error";
      turn.error = "aborted_by_user";
      turn.completedAt = new Date().toISOString();
      upsertSessionTurn(session, { ...turn });
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
    }

    appendSessionEvent(config.workspaceDir, session.sessionId, { type: "turn_begin" }, { turnId });
    emitEvent({
      type: "intent",
      capabilityId: compiledIntent.capabilityId,
      label: compiledIntent.capabilityId
        ? deskItemById(compiledIntent.capabilityId)?.label
        : undefined,
      lawyerSummary: compiledIntent.lawyerSummary,
      confidence: compiledIntent.confidence,
      source: compiledIntent.source,
      alternatives: compiledIntent.alternatives,
      chain: compiledIntent.chain,
      ...(compiledIntent.softAsk ? { softAsk: compiledIntent.softAsk } : {}),
    });

    const policyForCompact = workspacePolicy;
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
      tuning: contextTuning,
    });
    session.conversationHistory = compactResult.messages;
    if (compactResult.compacted) {
      session.needsCompactReinjection = true;
      // Same-turn reinjection: prepare already ran; patch system message before model loop.
      const mandatory = resolveAgentMandatoryRulesForPrompt(config.workspaceDir, policyForCompact);
      applyCompactReinjectionToSession(session, {
        mandatoryRulesActive: mandatory.active,
        tuning: contextTuning,
      });
      const boundaryId =
        compactResult.boundaryId ??
        `${new Date().toISOString()}#${compactResult.droppedMessageCount ?? 0}`;
      session.lastCompactBoundary = {
        boundaryId,
        at: new Date().toISOString(),
        droppedMessageCount: compactResult.droppedMessageCount,
        firstKeptTimestamp: compactResult.firstKeptTimestamp,
        firstKeptRole: compactResult.firstKeptRole,
        digestCharCount: compactResult.droppedDigest?.length,
        sessionSummaryPath: compactResult.sessionSummaryPath,
      };
      emitEvent({
        type: "compact_boundary",
        sessionSummaryPath: compactResult.sessionSummaryPath,
        droppedMessageCount: compactResult.droppedMessageCount,
        firstKeptTimestamp: compactResult.firstKeptTimestamp,
        firstKeptRole: compactResult.firstKeptRole,
        digestCharCount: compactResult.droppedDigest?.length,
        boundaryId,
      });
      emitTurnLifecycle({
        phase: "after_compact",
        sessionId: session.sessionId,
        turnId: turn.turnId,
        detail: {
          boundaryId,
          droppedMessageCount: compactResult.droppedMessageCount,
          firstKeptTimestamp: compactResult.firstKeptTimestamp,
        },
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
          ...(turn.instruction?.trim() ? { instruction: turn.instruction } : {}),
          continueTrigger: "delivery",
        });
        if (turn.requiresAction.length > 0) {
          session.pendingRequiresAction = turn.requiresAction;
        }
        upsertSessionTurn(session, { ...turn });
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

    const publicWebResult = await tryPublicWebFactShortcut({
      instruction,
      ctx,
      turn,
      registry,
      shared: finalizeShared(),
      emitEvent,
      abortRequested,
      onAborted: finishAbortedByUser,
    });
    if (publicWebResult) {
      return publicWebResult;
    }

    const intakePolicy = readWorkspacePolicyFile(config.workspaceDir);

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
      allowedToolNames: allowNamesForExec,
      roleId: roleForTools?.roleId,
      riskCeiling: roleForTools?.riskCeiling ?? presetForTools?.riskCeiling,
    });
    if (autoWfResult) {
      return autoWfResult;
    }

    const icloudStop = await runApprovedIcloudDownloads();
    if (icloudStop) {
      turn.status = "awaiting_clarification";
      turn.clarificationQuestions = [icloudStop];
      return finalizeAgentTurn({
        shared: finalizeShared(),
        finalReply: icloudStop.question,
        pendingClarificationQuestions: [icloudStop],
        turnUsage: undefined,
        actorId,
        resolvedAssistantId,
        modelName: config.model.model,
      });
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
        allowedToolNames: allowNamesForExec,
        deniedToolNames: denyNames,
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
      maxHistoryMessages: maxHistory,
      linkedTaskId: linkedTaskIdForCtx,
    });

    if (loop.aborted) {
      return finishAbortedByUser();
    }

    let finalReply = loop.finalReply;
    // 仅在回合已完成且可写时补 Word 改稿；澄清/只读/暂停不得绕过工具管线落盘。
    if (turn.status === "completed") {
      try {
        const { autoDeliverWordRevisionIfNeeded, successfullyExportedTaskIds } =
          await import("./word-revision-auto-deliver.js");
        const delivered = await autoDeliverWordRevisionIfNeeded({
          ctx,
          registry,
          turn,
        });
        if (delivered) {
          finalReply = [finalReply, delivered].filter((s) => s?.trim()).join("\n\n");
        }
        const { appendOpenWordCheckMarkers } = await import("../drafts/word-review.js");
        finalReply = appendOpenWordCheckMarkers({
          workspaceDir: ctx.workspaceDir,
          reply: finalReply ?? "",
          taskIds: successfullyExportedTaskIds(turn),
        });
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
    resetIsolationBudget(isolationKey(config.workspaceDir, session.sessionId));
    clearInterval(abortMirror);
    clearTurnAbort(session.sessionId);
    await Promise.all(mcpSessions.map((s) => s.close().catch(() => undefined)));
  }
}
