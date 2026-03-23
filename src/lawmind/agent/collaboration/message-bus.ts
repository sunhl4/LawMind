/**
 * Inter-assistant message bus.
 *
 * Routes messages between LawMind assistants within the same process.
 * Supports two delivery modes:
 *   - Synchronous (consult/review): caller blocks until the target replies
 *   - Asynchronous (delegate/notify): fire-and-continue, result announced later
 *
 * Adapted from OpenClaw's fire-wait-read pattern (src/agents/tools/agent-step.ts)
 * and subagent announce flow (src/agents/subagent-announce.ts).
 */

import { randomUUID } from "node:crypto";
import { loadAssistantProfiles, buildRoleDirectiveFromProfile } from "../../assistants/store.js";
import { createLawMindAgent } from "../index.js";
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
  const lawMindRoot =
    baseConfig.workspaceDir.replace(/[\\/]workspace$/, "") || baseConfig.workspaceDir;
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
 * This is the core "fire → run → read" cycle, analogous to OpenClaw's
 * runAgentStep() in src/agents/tools/agent-step.ts.
 */
export async function sendAndWait(params: {
  baseConfig: AgentConfig;
  fromAssistantId: string;
  toAssistantId: string;
  message: string;
  matterId?: string;
  timeoutMs?: number;
}): Promise<SendAndWaitResult> {
  const { baseConfig, fromAssistantId, toAssistantId, message, matterId } = params;
  const timeoutMs = params.timeoutMs ?? 60_000;

  const targetConfig = resolveAssistantConfig(baseConfig, toAssistantId);
  if (!targetConfig) {
    throw new Error(`Assistant not found: ${toAssistantId}`);
  }

  const agent = createLawMindAgent(targetConfig);

  const instruction = buildCollaborationInstruction({
    kind: "consult",
    fromAssistantId,
    message,
  });

  const resultPromise = agent.chat(instruction, { matterId });

  const result = await withTimeout(
    resultPromise,
    timeoutMs,
    `Consult to ${toAssistantId} timed out after ${timeoutMs}ms`,
  );

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
 * that resolves when the target finishes. Analogous to OpenClaw's
 * spawnSubagentDirect() + registerSubagentRun() pattern.
 */
export function fireAndForget(params: {
  baseConfig: AgentConfig;
  fromAssistantId: string;
  toAssistantId: string;
  message: string;
  matterId?: string;
  kind?: CollaborationMessageKind;
}): FireAndForgetResult {
  const { baseConfig, fromAssistantId, toAssistantId, message, matterId, kind } = params;
  const delegationId = randomUUID();

  const targetConfig = resolveAssistantConfig(baseConfig, toAssistantId);
  if (!targetConfig) {
    throw new Error(`Assistant not found: ${toAssistantId}`);
  }

  const agent = createLawMindAgent(targetConfig);

  const instruction = buildCollaborationInstruction({
    kind: kind ?? "delegate",
    fromAssistantId,
    message,
  });

  const completion = agent.chat(instruction, { matterId }).then((result) => ({
    reply: result.reply,
    turnId: result.turn.turnId,
    sessionId: result.sessionId,
  }));

  return {
    delegationId,
    targetSessionId: "",
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
