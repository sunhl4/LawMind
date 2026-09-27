import { createLawMindAgent } from "../../../src/lawmind/agent/index.js";
import { resumeTurn } from "../../../src/lawmind/agent/runtime-resume.js";
import { continueWorkflowJobsHeldOnSession } from "./lawmind-server-jobs.js";
import { createLegalToolRegistry } from "../../../src/lawmind/agent/tools/index.js";
import type { ResumeRequiresActionInput } from "../../../src/lawmind/platform/requires-action.js";
import type { RunTurnEvent } from "../../../src/lawmind/agent/index.js";
import { classifySessionInbox } from "../../../src/lawmind/agent/session-inbox.js";
import { loadSession } from "../../../src/lawmind/agent/session.js";
import { isSessionTurnInProgressError } from "../../../src/lawmind/agent/session-turn-gate.js";
import {
  embedSseEventName,
  LEGACY_FINAL_SSE_ALIAS,
} from "../../../src/lawmind/agent/embed-turn-events.js";
import {
  clearTurnAbort,
  isTurnAbortRequested,
} from "../../../src/lawmind/agent/turn-abort.js";
import { parsePermissionMode } from "../../../src/lawmind/agent/permission-mode.js";
import type { AgentConfig, AgentTurn, ToolCallResult } from "../../../src/lawmind/agent/types.js";
import { parseContextPins } from "../../../src/lawmind/platform/compose-context-pin.js";
import {
  buildAgentMemorySourceReport,
  loadMemoryContext,
  toEngineClientMemorySnapshot,
} from "../../../src/lawmind/memory/index.js";
import {
  isAdhocMeetingMatterId,
  parseOptionalMatterId,
} from "../../../src/lawmind/cases/index.js";
import { effectiveRouterMode } from "../../../src/lawmind/models/index.js";
import { resolveEdition } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import { deriveInstructionTitle } from "../../../src/lawmind/tasks/index.js";
import {
  buildRoleDirectiveFromProfile,
  bumpAssistantStats,
  DEFAULT_ASSISTANT_ID,
  getAssistantById,
  loadAssistantProfiles,
  resolveLawMindRoot,
} from "../../../src/lawmind/assistants/store.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { chatPostRequestSchema, chatResumeRequestSchema } from "./lawmind-api-schemas.js";
import { sendJsonError } from "./lawmind-api-error.js";
import { resolveChatAllowWebSearch } from "./lawmind-policy.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  buildAgentConfig,
  resolveDesktopActorId,
  resolveModelCallHttpError,
  safeOptionalProjectDir,
  sendJson,
} from "./lawmind-server-helpers.js";

/** 与 read_project_file / analyze_document 返回的 data.sourceType 对齐，供律师判断可信度 */
const DOC_READ_SOURCE_LABELS: Record<string, string> = {
  pdf: "PDF 文本层",
  pdf_ocr: "PDF·OCR",
  pdf_vision: "PDF·视觉",
  docx: "Word",
  xlsx: "Excel",
  image_ocr: "图片·OCR",
  image_vision: "图片·视觉",
};

const TOOLS_WITH_DOC_SOURCE_TYPE = new Set(["analyze_document", "read_project_file"]);
const PLATFORM_CONTRACTS_V1 =
  (process.env.LAWMIND_PLATFORM_CONTRACTS_V1 ?? "1").trim().toLowerCase() !== "0";

const LINKED_TASK_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/;

function parseOptionalLinkedTaskId(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new Error("invalid_linked_task_id");
  }
  const t = raw.trim();
  if (!t) {
    return undefined;
  }
  if (!LINKED_TASK_ID_RE.test(t)) {
    throw new Error("invalid_linked_task_id");
  }
  return t;
}

function formatToolCallChip(toolName: string, result?: ToolCallResult): string {
  if (!result?.ok || result.data === undefined || typeof result.data !== "object" || result.data === null) {
    return toolName;
  }
  const st = (result.data as { sourceType?: unknown }).sourceType;
  if (!TOOLS_WITH_DOC_SOURCE_TYPE.has(toolName) || typeof st !== "string" || !st.trim()) {
    return toolName;
  }
  const label = DOC_READ_SOURCE_LABELS[st] ?? st;
  return `${toolName}（${label}）`;
}

function toolCallSequenceFromTurn(turn: AgentTurn): string[] {
  const out: string[] = [];
  for (let mi = 0; mi < turn.messages.length; mi++) {
    const msg = turn.messages[mi];
    if (msg.role !== "assistant" || !msg.toolCalls?.length) {
      continue;
    }
    let scanFrom = mi + 1;
    for (const tc of msg.toolCalls) {
      let chip = tc.name;
      for (let j = scanFrom; j < turn.messages.length; j++) {
        const tm = turn.messages[j];
        if (tm.role !== "tool" || !tm.toolCallResponses?.length) {
          continue;
        }
        const resp = tm.toolCallResponses.find((r) => r.toolCallId === tc.id);
        if (!resp) {
          continue;
        }
        chip = formatToolCallChip(tc.name, resp.result);
        scanFrom = j + 1;
        break;
      }
      if (chip === "update_plan" || chip.startsWith("update_plan")) {
        continue;
      }
      out.push(chip);
    }
  }
  return out;
}

/**
 * 续跑澄清/拍板（`/api/chat/resume`）。
 *
 * 参数类型只声明它**真正用到**的四个字段：这个子处理器不读 `url` / `pathname`
 * （路由匹配在父处理器里做完了）。此前写成整个 `LawmindRouteContext`，
 * 而父处理器的调用点没传这两个字段 —— 类型上不成立，运行时无害，
 * 结果是一个**假错误**掩盖了真问题（长此以往「这条链真的没接线」也会被当成噪声）。
 */
async function handleChatResumeRoute({
  ctx,
  req,
  res,
  c,
}: Pick<LawmindRouteContext, "ctx" | "req" | "res" | "c">): Promise<boolean> {
  let body;
  try {
    body = await parseJsonBodyZod(req, chatResumeRequestSchema);
  } catch (err) {
    if (isInvalidRequestBodyError(err)) {
      const issues = err.issues.join(" ");
      if (issues.includes("decision")) {
        sendJsonError(res, 400, "invalid_decision", "decision 须为 approve、reject、edit 或 respond。", c);
        return true;
      }
      sendJsonError(res, 400, "resume_fields_required", "缺少 sessionId、actionId 或 decision。", c);
      return true;
    }
    throw err;
  }
  const { sessionId, actionId, decision } = body;

  const { workspaceDir, envFile } = ctx;
  const built = buildAgentConfig(workspaceDir, { envFile });
  if (built.error) {
    sendJsonError(res, 503, built.error, "模型未配置，无法继续。", c);
    return true;
  }
  const registry = createLegalToolRegistry({
    allowWebSearch: built.config.allowWebSearch === true,
    enableCollaboration: built.config.enableCollaboration === true,
    baseConfig: built.config.enableCollaboration ? built.config : undefined,
  });

  const input: ResumeRequiresActionInput = {
    sessionId,
    actionId,
    decision,
    editedArgs: body.editedArgs,
    clarificationAnswers: body.clarificationAnswers,
    resolvedBy: resolveDesktopActorId(),
  };

  try {
    const result = await resumeTurn(built.config, registry, input, { registry });
    if (result.turn.status === "completed") {
      continueWorkflowJobsHeldOnSession(result.sessionId, built.config, { reply: result.reply });
    }
    const payload: Record<string, unknown> = {
      ok: true,
      reply: result.reply,
      sessionId: result.sessionId,
      status: result.turn.status,
      requiresAction: result.turn.requiresAction,
      clarificationQuestions: result.turn.clarificationQuestions,
      taskId: result.turn.turnId,
      inboxKind: classifySessionInbox("chat"),
    };
    if (PLATFORM_CONTRACTS_V1) {
      payload.executionState = result.turn.executionState;
      payload.gateDecisions = result.turn.gateDecisions;
    }
    const resumePlan = loadSession(workspaceDir, result.sessionId)?.turnPlan;
    if (resumePlan) {
      payload.turnPlan = resumePlan;
    }
    sendJson(res, 200, payload, c);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "session_not_found") {
      sendJsonError(res, 404, "session_not_found", "会话不存在或已过期。", c);
      return true;
    }
    if (isSessionTurnInProgressError(err) || msg.startsWith("SESSION_TURN_IN_PROGRESS")) {
      sendJsonError(
        res,
        409,
        "session_turn_in_progress",
        "该会话已有一轮在执行。请等待完成或中止后再试。",
        c,
      );
      return true;
    }
    if (msg === "action_not_found") {
      sendJsonError(res, 404, "action_not_found", "待处理项不存在或已处理。", c);
      return true;
    }
    if (msg === "unsupported_resume") {
      sendJsonError(res, 400, "unsupported_resume", "当前待处理类型不支持该操作。", c);
      return true;
    }
    throw err;
  }
  return true;
}

export async function handleChatRoute({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname === "/api/chat/resume" && req.method === "POST") {
    return handleChatResumeRoute({ ctx, req, res, c });
  }
  if (!(pathname === "/api/chat" && req.method === "POST")) {
    return false;
  }

  const { workspaceDir, envFile, policy: policyState } = ctx;
  let body;
  try {
    body = await parseJsonBodyZod(req, chatPostRequestSchema);
  } catch (err) {
    if (isInvalidRequestBodyError(err)) {
      sendJsonError(res, 400, "invalid_request_body", err.message, c);
      return true;
    }
    throw err;
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    sendJsonError(res, 400, "message_required", "请输入对话内容后再发送。", c);
    return true;
  }

  const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
  const assistantIdRaw = typeof body.assistantId === "string" ? body.assistantId.trim() : "";
  const assistantKey = assistantIdRaw || DEFAULT_ASSISTANT_ID;
  let profile = getAssistantById(lawMindRoot, assistantKey) ?? getAssistantById(lawMindRoot, DEFAULT_ASSISTANT_ID);
  if (!profile) {
    const all = loadAssistantProfiles(lawMindRoot);
    profile = all[0];
  }
  if (!profile) {
    sendJsonError(
      res,
      500,
      "no_assistant_profile",
      "未找到助手配置。请在设置中创建助手或检查 LawMind 根目录下的 assistants.json。",
      c,
    );
    return true;
  }

  const requestModelId = typeof body.modelId === "string" ? body.modelId.trim() : undefined;
  const built = buildAgentConfig(workspaceDir, { envFile, modelId: requestModelId });
  if (
    built.error === "missing_api_key" ||
    built.error === "missing_provider_api_key" ||
    built.error === "missing_platform_api_key"
  ) {
    const message =
      built.error === "missing_platform_api_key"
        ? "组织提供的模型还没开通。请用连接向导填写自己的密钥，或联系管理员。"
        : built.error === "missing_provider_api_key"
          ? "当前模型的服务商还没填写密钥。请在设置 → 模型与连接里填写，或改用已经配好的模型。"
          : "还没填写模型密钥。请在设置里打开连接向导，或添加自定义模型。";
    sendJsonError(res, 503, built.error, message, c);
    return true;
  }

  const role = buildRoleDirectiveFromProfile(profile);
  const allowWebSearch = resolveChatAllowWebSearch(body.allowWebSearch === true);
  const enableCollaboration =
    body.enableCollaboration !== false && built.config.enableCollaboration !== false;
  const desktopActor = resolveDesktopActorId();
  const permissionMode = parsePermissionMode(body.permissionMode);
  const config: AgentConfig = {
    ...built.config,
    actorId: `${desktopActor}|asst:${profile.assistantId}`,
    assistantId: profile.assistantId,
    roleTitle: role.roleTitle,
    roleIntroduction: role.roleIntroduction,
    roleDirective: role.roleDirective,
    allowWebSearch,
    enableCollaboration:
      permissionMode === "readonly" || permissionMode === "research" ? false : enableCollaboration,
    permissionMode,
    strictDangerousToolApproval:
      permissionMode === "strict" || built.config.strictDangerousToolApproval === true,
    envFile,
  };

  let matterIdForChat: string | undefined;
  try {
    matterIdForChat = parseOptionalMatterId(body.matterId);
  } catch {
    sendJsonError(
      res,
      400,
      "invalid_matter_id",
      "案件 ID 格式不正确。请清空关联案件或按规则修改后再试。",
      c,
    );
    return true;
  }

  let linkedTaskIdForChat: string | undefined;
  try {
    linkedTaskIdForChat = parseOptionalLinkedTaskId(body.linkedTaskId);
  } catch {
    sendJsonError(
      res,
      400,
      "invalid_linked_task_id",
      "关联任务 ID 格式不正确。请清空工作台关联草稿或缩短后再试。",
      c,
    );
    return true;
  }

  const parsedContextPins = parseContextPins(body.contextPins);
  if (!Array.isArray(parsedContextPins)) {
    sendJsonError(
      res,
      400,
      "invalid_context_pins",
      "本回合重点（contextPins）格式不正确。请移除钉选后重试。",
      c,
    );
    return true;
  }
  const contextPinsForAgent = parsedContextPins.length > 0 ? parsedContextPins : undefined;

  const meetingMode = body.meetingMode === true;
  if (meetingMode) {
    sendJsonError(
      res,
      400,
      "meeting_retired",
      "会议室讨论已停用。请在当前对话里交办；交卷时由独立审稿对照材料，不再轮流发言。",
      c,
    );
    return true;
  }

  const agent = createLawMindAgent(config);
  const hadSession = Boolean(body.sessionId?.trim());
  const projectDirForAgent = safeOptionalProjectDir(body.projectDir);

  const instructionForAgent = message;

  const wantsStream =
    typeof req.headers.accept === "string" && req.headers.accept.includes("text/event-stream");

  try {
    const sessionTitleHint =
      typeof body.sessionTitleHint === "string" && body.sessionTitleHint.trim()
        ? body.sessionTitleHint.trim()
        : undefined;

    let sseClosed = false;
    /** Set true after `agent.chat` returns so a late `req.close` cannot abort the next turn. */
    let turnFinished = false;
    let ssePingTimer: ReturnType<typeof setInterval> | null = null;
    const sseWriteEvent = (event: string, data: unknown): void => {
      if (sseClosed || res.writableEnded) {return;}
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        sseClosed = true;
      }
    };
    const sseEnd = (): void => {
      if (sseClosed) {return;}
      sseClosed = true;
      if (ssePingTimer) {
        clearInterval(ssePingTimer);
        ssePingTimer = null;
      }
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    };

    if (wantsStream) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        ...c,
      });
      ssePingTimer = setInterval(() => {
        if (!sseClosed && !res.writableEnded) {
          try {
            res.write(": ping\n\n");
          } catch {
            sseEnd();
          }
        }
      }, 25_000);
      req.on("close", () => {
        // Disconnect abort is signaled via `sseClosed` → `shouldAbort` for *this* turn only.
        // Do not call `requestTurnAbort` here: normal completion also fires `close` after
        // `sseEnd`, which would race a fast follow-up turn that already cleared the flag.
        if (!turnFinished) {
          sseEnd();
        }
      });
    }

    const onEvent: ((event: RunTurnEvent) => void) | undefined = wantsStream
      ? (event) => {
          switch (event.type) {
            case "round_start":
              sseWriteEvent("round_start", { roundIndex: event.roundIndex });
              break;
            case "tool_call_start":
              sseWriteEvent("tool_call_start", {
                roundIndex: event.roundIndex,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
              });
              break;
            case "tool_call_end":
              sseWriteEvent("tool_call_end", {
                roundIndex: event.roundIndex,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                ok: event.ok,
                error: event.error,
                ...(event.authorityGap ? { authorityGap: true } : {}),
                ...(event.demoCorpus ? { demoCorpus: true } : {}),
                ...(event.nextActions && event.nextActions.length > 0
                  ? { nextActions: event.nextActions }
                  : {}),
                ...(event.resultPreview ? { resultPreview: event.resultPreview } : {}),
                ...(event.sessionRefs && event.sessionRefs.length > 0
                  ? { sessionRefs: event.sessionRefs }
                  : {}),
              });
              break;
            case "tool_progress":
              sseWriteEvent("tool_progress", {
                roundIndex: event.roundIndex,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                label: event.label,
              });
              break;
            case "delta":
              sseWriteEvent("delta", { roundIndex: event.roundIndex, text: event.text });
              break;
            case "clarification":
              sseWriteEvent("clarification", { questions: event.questions });
              break;
            case "final":
              sseWriteEvent(embedSseEventName(event.type), {
                status: event.status,
                reply: event.reply,
              });
              sseWriteEvent(LEGACY_FINAL_SSE_ALIAS, { status: event.status, reply: event.reply });
              break;
            case "token_budget":
              sseWriteEvent("token_budget", {
                used: event.used,
                effectiveLimit: event.effectiveLimit,
                level: event.level,
              });
              break;
            case "tool_budget":
              sseWriteEvent("tool_budget", {
                used: event.used,
                maxToolCalls: event.maxToolCalls,
                level: event.level,
              });
              break;
            case "compact_boundary":
              sseWriteEvent("compact_boundary", {
                sessionSummaryPath: event.sessionSummaryPath,
                droppedMessageCount: event.droppedMessageCount,
                firstKeptTimestamp: event.firstKeptTimestamp,
                firstKeptRole: event.firstKeptRole,
                digestCharCount: event.digestCharCount,
                boundaryId: event.boundaryId,
                // 回合内整理（工具轮边界）：律师要能看出「整理过，但本回合没断」。
                midTurn: event.midTurn === true,
                roundIndex: event.roundIndex,
              });
              break;
            case "model_error":
              sseWriteEvent("model_error", {
                roundIndex: event.roundIndex,
                message: event.message,
              });
              break;
            case "tool_delta":
              sseWriteEvent("tool_delta", {
                roundIndex: event.roundIndex,
                added: event.added,
                removed: event.removed,
              });
              break;
            case "overflow_prune":
              sseWriteEvent("overflow_prune", {
                prunedCount: event.prunedCount,
                charsRemoved: event.charsRemoved,
              });
              break;
            case "context_deferral_bounce":
              sseWriteEvent("context_deferral_bounce", {
                roundIndex: event.roundIndex,
                bounceCount: event.bounceCount,
              });
              break;
            // 这两个是「中途需要律师拍板」的事件，必须在回合结束前就流出去；
            // 以前它们掉进 default 被静默丢弃，第二个窗口 / live-turn 只能等回合收口
            // 才从末端 payload 看到暂停。契约见 src/lawmind/agent/embed-turn-events.ts。
            case "requires_action":
              sseWriteEvent("requires_action", { payload: event.payload });
              break;
            case "approval_request":
              sseWriteEvent("approval_request", {
                roundIndex: event.roundIndex,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                gateDecision: event.gateDecision,
              });
              break;
            case "plan_update":
              sseWriteEvent("plan_update", { plan: event.plan });
              break;
            case "intent":
              sseWriteEvent("intent", {
                capabilityId: event.capabilityId,
                label: event.label,
                lawyerSummary: event.lawyerSummary,
                confidence: event.confidence,
                source: event.source,
                alternatives: event.alternatives,
                chain: event.chain,
                ...(event.softAsk ? { softAsk: event.softAsk } : {}),
              });
              break;
            default:
              break;
          }
        }
      : undefined;

    // Ad-hoc「临时讨论」is not a CASE matter — keep transcript key, skip case memory attach.
    const caseMemoryMatterId =
      matterIdForChat && !isAdhocMeetingMatterId(matterIdForChat) ? matterIdForChat : undefined;

    const abortSessionId =
      typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : undefined;
    let result: Awaited<ReturnType<typeof agent.chat>>;
    try {
      result = await agent.chat(instructionForAgent, {
        sessionId: body.sessionId,
        matterId: caseMemoryMatterId,
        assistantId: profile.assistantId,
        allowWebSearch,
        projectDir: projectDirForAgent,
        sessionTitleHint,
        linkedTaskId: linkedTaskIdForChat,
        onEvent,
        contextPins: contextPinsForAgent,
        shouldAbort: () =>
          Boolean(abortSessionId && isTurnAbortRequested(abortSessionId)) ||
          (wantsStream && sseClosed),
      });
    } finally {
      turnFinished = true;
      if (abortSessionId) {
        clearTurnAbort(abortSessionId);
      }
    }
    bumpAssistantStats(lawMindRoot, profile.assistantId, {
      newSession: !hadSession,
      turn: true,
    });
    const engineMem =
      result.memoryContext ??
      (await loadMemoryContext(workspaceDir, { matterId: caseMemoryMatterId }));
    const memorySources = await buildAgentMemorySourceReport(workspaceDir, {
      matterId: caseMemoryMatterId,
      assistantId: profile.assistantId,
      lawMindRoot,
      engineMemory: toEngineClientMemorySnapshot(engineMem),
    });
    const policyForEdition: LawMindWorkspacePolicy | null = policyState.loaded
      ? (policyState.policy as LawMindWorkspacePolicy)
      : null;
    const edition = resolveEdition({ policy: policyForEdition });
    const showRuntimeHints =
      body.includeTurnDiagnostics === true ||
      edition.edition === "firm" ||
      edition.edition === "private_deploy";
    const payload: Record<string, unknown> = {
      ok: true,
      reply: result.reply,
      sessionId: result.sessionId,
      modelId: built.modelId,
      assistantId: profile.assistantId,
      toolCalls: result.turn.toolCallsExecuted,
      toolCallSequence: toolCallSequenceFromTurn(result.turn),
      status: result.turn.status,
      clarificationQuestions: result.turn.clarificationQuestions,
      taskId: result.turn.turnId,
      taskTitle: deriveInstructionTitle(message),
      memorySources,
      inboxKind: classifySessionInbox("chat"),
    };
    if (PLATFORM_CONTRACTS_V1) {
      payload.executionState = result.turn.executionState;
      payload.gateDecisions = result.turn.gateDecisions;
    }
    if (result.turn.requiresAction?.length) {
      payload.requiresAction = result.turn.requiresAction;
    }
    const turnPlan = loadSession(workspaceDir, result.sessionId)?.turnPlan;
    if (turnPlan) {
      payload.turnPlan = turnPlan;
    }
    if (linkedTaskIdForChat) {
      payload.linkedTaskId = linkedTaskIdForChat;
    }
    if (showRuntimeHints) {
      payload.runtimeHints = {
        lawmindRouterMode: effectiveRouterMode(lawMindRoot),
        lawmindReasoningMode: (process.env.LAWMIND_REASONING_MODE ?? "").trim() || "off",
        toolCallsExecuted: result.turn.toolCallsExecuted,
        platformContractsV1: PLATFORM_CONTRACTS_V1,
      };
    }
    if (wantsStream) {
      sseWriteEvent("payload", payload);
      sseWriteEvent("done", { ok: true });
      sseEnd();
    } else {
      sendJson(res, 200, payload, c);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const writeStreamError = (status: number, code: string, message: string): void => {
      if (!res.writableEnded) {
        try {
          res.write(
            `event: error\ndata: ${JSON.stringify({ ok: false, status, code, message })}\n\n`,
          );
          res.write(`event: done\ndata: ${JSON.stringify({ ok: false })}\n\n`);
          res.end();
        } catch {
          /* ignore */
        }
      }
    };
    if (isSessionTurnInProgressError(err) || msg.startsWith("SESSION_TURN_IN_PROGRESS")) {
      if (wantsStream && res.headersSent) {
        writeStreamError(
          409,
          "session_turn_in_progress",
          "该会话已有一轮在执行。请等待完成或中止后再试。",
        );
        return true;
      }
      sendJsonError(
        res,
        409,
        "session_turn_in_progress",
        "该会话已有一轮在执行。请等待完成或中止后再试。",
        c,
      );
      return true;
    }
    if (msg === "session_assistant_mismatch") {
      if (wantsStream && res.headersSent) {
        writeStreamError(
          409,
          "session_assistant_mismatch",
          "该会话属于其他助手，请新开对话或清空会话后重试。",
        );
        return true;
      }
      sendJsonError(
        res,
        409,
        "session_assistant_mismatch",
        "该会话属于其他助手，请新开对话或清空会话后重试。",
        c,
      );
      return true;
    }
    const modelErr = resolveModelCallHttpError(err);
    if (modelErr) {
      if (wantsStream && res.headersSent) {
        writeStreamError(modelErr.status, modelErr.code, modelErr.message);
        return true;
      }
      sendJsonError(res, modelErr.status, modelErr.code, modelErr.message, c);
      return true;
    }
    if (wantsStream && res.headersSent) {
      writeStreamError(500, "internal_error", msg);
      return true;
    }
    throw err;
  }
  return true;
}
