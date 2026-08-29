/**
 * Inter-assistant message bus.
 *
 * Routes messages between LawMind assistants within the same process.
 * Supports two delivery modes:
 *   - Synchronous (consult/review): caller blocks until the target replies
 *   - Asynchronous (delegate/notify): fire-and-continue, result announced later
 *
 * Adapted from reference stack's fire-wait-read pattern (src/agents/tools/agent-step.ts)
 * and subagent announce flow (src/agents/subagent-announce.ts).
 */

import { randomUUID } from "node:crypto";
import {
  buildRoleDirectiveFromProfile,
  loadAssistantProfiles,
  resolveLawMindRoot,
} from "../../assistants/store.js";
import { createLawMindAgent } from "../agent-factory.js";
import { inheritChildGates } from "../child-gates.js";
import type { AgentPermissionMode } from "../permission-mode.js";
import { saveSession } from "../session.js";
import type { AgentConfig } from "../types.js";
import type { CollaborationMessage, CollaborationMessageKind } from "./types.js";

const UNTRUSTED_BEGIN = "<<<BEGIN_UNTRUSTED_ASSISTANT_RESULT>>>";
const UNTRUSTED_END = "<<<END_UNTRUSTED_ASSISTANT_RESULT>>>";

export type SendAndWaitResult = {
  reply: string;
  turnId: string;
  sessionId: string;
};

export type FireAndForgetResult = {
  delegationId: string;
  targetSessionId: string;
  /** Resolves when the target turn completes */
  completion: Promise<{ reply: string; turnId: string; sessionId: string }>;
};

/**
 * Wraps untrusted assistant output so the receiving assistant's LLM
 * treats it as data rather than instructions (prompt injection defense).
 */
export function wrapUntrustedResult(text: string): string {
  return `${UNTRUSTED_BEGIN}\n${text}\n${UNTRUSTED_END}`;
}

/**
 * Resolve the AgentConfig for a target assistant by merging the base config
 * with the assistant's profile (role, introduction, directive).
 */
function resolveAssistantConfig(
  baseConfig: AgentConfig,
  targetAssistantId: string,
): AgentConfig | undefined {
  const lawMindRoot = resolveLawMindRoot(baseConfig.workspaceDir, baseConfig.envFile);
  const profiles = loadAssistantProfiles(lawMindRoot);
  const profile = profiles.find((p) => p.assistantId === targetAssistantId);
  if (!profile) {
    return undefined;
  }

  const role = buildRoleDirectiveFromProfile(profile);
  return {
    ...baseConfig,
    actorId: `assistant:${profile.assistantId}`,
    assistantId: profile.assistantId,
    roleTitle: role.roleTitle,
    roleIntroduction: role.roleIntroduction,
    roleDirective: role.roleDirective,
  };
}

/**
 * Send a message to another assistant and wait for the reply (synchronous).
 *
 * This is the core "fire → run → read" cycle, analogous to reference stack's
 * runAgentStep() in src/agents/tools/agent-step.ts.
 */
export async function sendAndWait(params: {
  baseConfig: AgentConfig;
  fromAssistantId: string;
  toAssistantId: string;
  message: string;
  matterId?: string;
  timeoutMs?: number;
  /** 模板级工具预批准（executor 已按白名单过滤）。 */
  preApproveToolNames?: string[];
  /** 指令头标签：consult（默认）或 review_request（request_review 专用）。 */
  kind?: "consult" | "review_request";
  permissionMode?: AgentPermissionMode;
  allowedToolNames?: string[];
  toolSandboxEnabled?: boolean;
}): Promise<SendAndWaitResult> {
  const { baseConfig, fromAssistantId, toAssistantId, message, matterId } = params;
  const timeoutMs = params.timeoutMs ?? 60_000;

  const targetConfig = resolveAssistantConfig(baseConfig, toAssistantId);
  if (!targetConfig) {
    const root = resolveLawMindRoot(baseConfig.workspaceDir, baseConfig.envFile);
    const names = loadAssistantProfiles(root)
      .map((p) => p.displayName)
      .join("、");
    throw new Error(
      `Assistant not found: ${toAssistantId}` +
        (names ? `（当前可读助手：${names}；请确认桌面端助手配置与工作区路径一致）` : ""),
    );
  }

  const gates = inheritChildGates({
    parent: {
      permissionMode: params.permissionMode ?? targetConfig.permissionMode ?? "standard",
      matterId,
      allowedToolNames: params.allowedToolNames,
      toolSandboxEnabled: params.toolSandboxEnabled === true,
    },
    childPermissionMode: targetConfig.permissionMode,
  });
  const childConfig: AgentConfig = {
    ...targetConfig,
    permissionMode: gates.permissionMode,
    allowedToolNames: gates.allowedToolNames,
    ...(gates.toolSandboxEnabled ? { toolSandboxEnabled: true } : {}),
  };
  const agent = createLawMindAgent(childConfig);

  const instruction = buildCollaborationInstruction({
    kind: params.kind ?? "consult",
    fromAssistantId,
    message,
  });

  const abortController = new AbortController();
  const resultPromise = agent.chat(instruction, {
    matterId: gates.matterId ?? matterId,
    permissionMode: childConfig.permissionMode,
    preApproveToolNames: params.preApproveToolNames,
    shouldAbort: () => abortController.signal.aborted,
  });

  let result: Awaited<typeof resultPromise>;
  try {
    result = await withTimeout(
      resultPromise,
      timeoutMs,
      `Consult to ${toAssistantId} timed out after ${timeoutMs}ms`,
    );
  } catch (err) {
    // 超时后协作式中止底层子会话（模型轮间生效），避免子 agent 继续跑到完成。
    abortController.abort();
    void resultPromise.catch(() => undefined);
    throw err;
  }

  return {
    reply: result.reply,
    turnId: result.turn.turnId,
    sessionId: result.sessionId,
  };
}

/**
 * Send a message to another assistant without waiting (asynchronous).
 *
 * Returns immediately with a delegationId and a completion promise
 * that resolves when the target finishes. Analogous to reference stack's
 * spawnSubagentDirect() + registerSubagentRun() pattern.
 */
export function fireAndForget(params: {
  baseConfig: AgentConfig;
  fromAssistantId: string;
  toAssistantId: string;
  message: string;
  matterId?: string;
  kind?: CollaborationMessageKind;
  /** Registry id — must match transcript / cancel / timeout (defaults to new UUID). */
  delegationId?: string;
  /** Nesting depth for child tool registry (parent depth + 1). */
  collaborationDepth?: number;
  /** Inherit parent's compose permission mode when set. */
  permissionMode?: AgentConfig["permissionMode"];
  allowedToolNames?: string[];
  toolSandboxEnabled?: boolean;
  /** Abort child turn after this many ms (0 = no timer). */
  timeoutMs?: number;
  onTimeout?: (targetSessionId: string) => void;
}): FireAndForgetResult {
  const { baseConfig, fromAssistantId, toAssistantId, message, matterId, kind } = params;
  const delegationId = params.delegationId?.trim() || randomUUID();
  const collaborationDepth = Math.max(0, params.collaborationDepth ?? 0);

  const targetConfig = resolveAssistantConfig(baseConfig, toAssistantId);
  if (!targetConfig) {
    const root = resolveLawMindRoot(baseConfig.workspaceDir, baseConfig.envFile);
    const names = loadAssistantProfiles(root)
      .map((p) => p.displayName)
      .join("、");
    throw new Error(
      `Assistant not found: ${toAssistantId}` +
        (names ? `（当前可读助手：${names}；请确认桌面端助手配置与工作区路径一致）` : ""),
    );
  }

  const gates = inheritChildGates({
    parent: {
      permissionMode: params.permissionMode ?? targetConfig.permissionMode ?? "standard",
      matterId,
      allowedToolNames: params.allowedToolNames,
      toolSandboxEnabled: params.toolSandboxEnabled === true,
    },
    childPermissionMode: targetConfig.permissionMode,
  });
  const childConfig: AgentConfig = {
    ...targetConfig,
    permissionMode: gates.permissionMode,
    allowedToolNames: gates.allowedToolNames,
    ...(gates.toolSandboxEnabled ? { toolSandboxEnabled: true } : {}),
    collaborationDepth,
  };
  const agent = createLawMindAgent(childConfig);

  const kindResolved = kind ?? "delegate";
  const preSession = agent.newSession({
    matterId: gates.matterId ?? matterId,
    title: `[协作] ${kindResolved} · ${fromAssistantId}`.slice(0, 200),
  });
  preSession.collaborationDelegationId = delegationId;
  saveSession(baseConfig.workspaceDir, preSession);
  const targetSessionId = preSession.sessionId;

  const instruction = buildCollaborationInstruction({
    kind: kindResolved,
    fromAssistantId,
    message,
  });

  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = params.timeoutMs ?? 0;
  if (timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      params.onTimeout?.(targetSessionId);
    }, timeoutMs);
  }

  const completion = agent
    .chat(instruction, {
      matterId: gates.matterId ?? matterId,
      sessionId: targetSessionId,
      liveProgressSessionId: targetSessionId,
      permissionMode: childConfig.permissionMode,
    })
    .then((result) => ({
      reply: result.reply,
      turnId: result.turn.turnId,
      sessionId: result.sessionId,
    }))
    .finally(() => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
    });

  return {
    delegationId,
    targetSessionId,
    completion,
  };
}

/**
 * Build the instruction text that the target assistant receives,
 * clearly marking the inter-assistant provenance.
 */
function buildCollaborationInstruction(params: {
  kind: CollaborationMessageKind;
  fromAssistantId: string;
  message: string;
}): string {
  const { kind, fromAssistantId, message } = params;

  const kindLabels: Record<CollaborationMessageKind, string> = {
    delegate: "任务委派",
    consult: "协作咨询",
    notify: "信息通知",
    review_request: "审查请求",
    result: "结果回传",
  };

  const label = kindLabels[kind] ?? kind;

  return `[${label}] 来自助手「${fromAssistantId}」的消息：\n\n${message}\n\n请根据你的岗位职责处理上述请求，完成后给出完整回复。`;
}

/**
 * Record a collaboration message for audit purposes.
 */
export function buildCollaborationMessage(params: {
  kind: CollaborationMessageKind;
  fromAssistantId: string;
  toAssistantId: string;
  sourceSessionId: string;
  matterId?: string;
  payload: string;
  context?: string;
  replyTo?: string;
}): CollaborationMessage {
  return {
    messageId: randomUUID(),
    kind: params.kind,
    fromAssistantId: params.fromAssistantId,
    toAssistantId: params.toAssistantId,
    sourceSessionId: params.sourceSessionId,
    matterId: params.matterId,
    payload: params.payload,
    context: params.context,
    replyTo: params.replyTo,
    createdAt: new Date().toISOString(),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
