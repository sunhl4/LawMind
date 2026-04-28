import { createLawMindAgent } from "../../../src/lawmind/agent/index.js";
import type { AgentConfig, AgentTurn } from "../../../src/lawmind/agent/types.js";
import {
  buildAgentMemorySourceReport,
  loadMemoryContext,
  toEngineClientMemorySnapshot,
} from "../../../src/lawmind/memory/index.js";
import { parseOptionalMatterId } from "../../../src/lawmind/cases/index.js";
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
import { sendJsonError } from "./lawmind-api-error.js";
import { isWebSearchForcedOffByPolicy } from "./lawmind-policy.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  buildAgentConfig,
  readJsonBody,
  resolveDesktopActorId,
  safeOptionalProjectDir,
  sendJson,
} from "./lawmind-server-helpers.js";

function toolCallSequenceFromTurn(turn: AgentTurn): string[] {
  const out: string[] = [];
  for (const message of turn.messages) {
    if (message.role !== "assistant" || !message.toolCalls?.length) {
      continue;
    }
    for (const toolCall of message.toolCalls) {
      out.push(toolCall.name);
    }
  }
  return out;
}

export async function handleChatRoute({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (!(pathname === "/api/chat" && req.method === "POST")) {
    return false;
  }

  const { workspaceDir, envFile, policy: policyState } = ctx;
  const body = (await readJsonBody(req)) as {
    message?: string;
    sessionId?: string;
    matterId?: string;
    assistantId?: string;
    allowWebSearch?: boolean;
    enableCollaboration?: boolean;
    projectDir?: string;
    /** 请求在 JSON 体中附带引擎路由/推理模式等调试摘要（Solo 默认关闭，见下方 edition 判断）。 */
    includeTurnDiagnostics?: boolean;
  };
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

  const built = buildAgentConfig(workspaceDir);
  if (built.error === "missing_api_key") {
    sendJsonError(
      res,
      503,
      "missing_api_key",
      "未配置模型 API Key。请在用户目录 LawMind/.env.lawmind 或设置向导中填写 LAWMIND_QWEN_API_KEY 等变量。",
      c,
    );
    return true;
  }

  const role = buildRoleDirectiveFromProfile(profile);
  let allowWebSearch = body.allowWebSearch === true;
  if (isWebSearchForcedOffByPolicy()) {
    allowWebSearch = false;
  }
  const enableCollaboration =
    body.enableCollaboration !== false && built.config.enableCollaboration !== false;
  const desktopActor = resolveDesktopActorId();
  const config: AgentConfig = {
    ...built.config,
    actorId: `${desktopActor}|asst:${profile.assistantId}`,
    assistantId: profile.assistantId,
    roleTitle: role.roleTitle,
    roleIntroduction: role.roleIntroduction,
    roleDirective: role.roleDirective,
    allowWebSearch,
    enableCollaboration,
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

  const agent = createLawMindAgent(config);
  const hadSession = Boolean(body.sessionId?.trim());
  const projectDirForAgent = safeOptionalProjectDir(body.projectDir);
  try {
    const result = await agent.chat(message, {
      sessionId: body.sessionId,
      matterId: matterIdForChat,
      assistantId: profile.assistantId,
      allowWebSearch,
      projectDir: projectDirForAgent,
    });
    bumpAssistantStats(lawMindRoot, profile.assistantId, {
      newSession: !hadSession,
      turn: true,
    });
    const engineMem =
      result.memoryContext ??
      (await loadMemoryContext(workspaceDir, { matterId: matterIdForChat }));
    const memorySources = await buildAgentMemorySourceReport(workspaceDir, {
      matterId: matterIdForChat,
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
      assistantId: profile.assistantId,
      toolCalls: result.turn.toolCallsExecuted,
      toolCallSequence: toolCallSequenceFromTurn(result.turn),
      status: result.turn.status,
      clarificationQuestions: result.turn.clarificationQuestions,
      taskId: result.turn.turnId,
      taskTitle: deriveInstructionTitle(message),
      memorySources,
    };
    if (showRuntimeHints) {
      payload.runtimeHints = {
        lawmindRouterMode: (process.env.LAWMIND_ROUTER_MODE ?? "").trim() || "keyword",
        lawmindReasoningMode: (process.env.LAWMIND_REASONING_MODE ?? "").trim() || "off",
        toolCallsExecuted: result.turn.toolCallsExecuted,
      };
    }
    sendJson(res, 200, payload, c);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "session_assistant_mismatch") {
      sendJsonError(
        res,
        409,
        "session_assistant_mismatch",
        "该会话属于其他助手，请新开对话或清空会话后重试。",
        c,
      );
      return true;
    }
    throw err;
  }
  return true;
}
