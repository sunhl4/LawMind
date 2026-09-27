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
import { loadSession, saveSession } from "../session.js";
import type { AgentConfig, AgentTurn } from "../types.js";
import { runIsolatedCollaborationWorker } from "./isolated-worker.js";
import type { CollaborationMessage, CollaborationMessageKind } from "./types.js";

const UNTRUSTED_BEGIN = "<<<BEGIN_UNTRUSTED_ASSISTANT_RESULT>>>";
const UNTRUSTED_END = "<<<END_UNTRUSTED_ASSISTANT_RESULT>>>";

export type CollaborationTurnHold = "awaiting_clarification" | "awaiting_approval" | "paused";

export type SendAndWaitResult = {
  reply: string;
  turnId: string;
  sessionId: string;
  /** 子回合停在澄清、批准或暂停。调用方不得把这一步当成已经办完。 */
  hold?: CollaborationTurnHold;
  /** 先停下等律师，律师作答后这一步才交回。 */
  settledByLawyer?: boolean;
};

export function collaborationTurnHold(
  status: string | undefined,
): CollaborationTurnHold | undefined {
  if (
    status === "awaiting_clarification" ||
    status === "awaiting_approval" ||
    status === "paused"
  ) {
    return status;
  }
  return undefined;
}

export function readCollaborationTurnSettlement(
  turns: Array<Pick<AgentTurn, "turnId" | "status" | "result" | "error">> | undefined,
):
  | { state: "pending" }
  | { state: "hold"; hold: CollaborationTurnHold; reply: string; turnId: string }
  | { state: "done"; reply: string; turnId: string }
  | { state: "error"; message: string } {
  const last = turns?.[turns.length - 1];
  if (!last?.status || last.status === "running") {
    return { state: "pending" };
  }
  const reply = last.result?.trim() ?? "";
  const turnId = last.turnId ?? "";
  const hold = collaborationTurnHold(last.status);
  if (hold) {
    return { state: "hold", hold, reply, turnId };
  }
  if (last.status === "error" || last.status === "interrupted") {
    return { state: "error", message: last.error?.trim() || "这一步没有办完。" };
  }
  if (last.status === "completed") {
    if (!reply) {
      return { state: "error", message: "这一步没有写出可用答复。请重试，或改在当前对话里办理。" };
    }
    return { state: "done", reply, turnId };
  }
  return { state: "pending" };
}

export type FireAndForgetResult = {
  delegationId: string;
  targetSessionId: string;
  /** Resolves when the target turn completes, or when it is waiting on the lawyer. */
  completion: Promise<SendAndWaitResult>;
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

const EMPTY_DELIVER_REPLY = "这一步没有写出可用答复。请重试，或改在当前对话里办理。";

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("已停止"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("已停止"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Full turn for drafting and delegation. Collaboration tools stay off so the
 * child cannot delegate again. If the turn pauses for the lawyer, wait until
 * they answer or the deadline passes.
 */
function beginDeliverCollaborationTurn(params: {
  baseConfig: AgentConfig;
  targetConfig: AgentConfig;
  matterId?: string;
  title: string;
  instruction: string;
  delegationId?: string;
  preApproveToolNames?: string[];
  timeoutMs: number;
  timeoutMessage: string;
}): { sessionId: string; done: Promise<SendAndWaitResult> } {
  const deliverConfig: AgentConfig = { ...params.targetConfig, enableCollaboration: false };
  const agent = createLawMindAgent(deliverConfig);
  const session = agent.newSession({ matterId: params.matterId, title: params.title });
  session.omitFromChatSwitcher = true;
  if (params.delegationId?.trim()) {
    session.collaborationDelegationId = params.delegationId.trim();
  }
  saveSession(params.baseConfig.workspaceDir, session);
  const abortController = new AbortController();
  const started = Date.now();
  const done = (async (): Promise<SendAndWaitResult> => {
    try {
      const result = await withTimeout(
        agent.chat(params.instruction, {
          sessionId: session.sessionId,
          matterId: params.matterId,
          preApproveToolNames: params.preApproveToolNames,
          shouldAbort: () => abortController.signal.aborted,
        }),
        params.timeoutMs,
        params.timeoutMessage,
      );
      const reply = result.reply.trim();
      const hold = collaborationTurnHold(result.turn.status);
      if (!hold) {
        if (!reply) {
          throw new Error(EMPTY_DELIVER_REPLY);
        }
        return {
          reply,
          turnId: result.turn.turnId,
          sessionId: result.sessionId,
        };
      }
      const remaining = params.timeoutMs - (Date.now() - started);
      const settled = await pollCollaborationSession({
        workspaceDir: params.baseConfig.workspaceDir,
        sessionId: session.sessionId,
        deadlineMs: Date.now() + Math.max(0, remaining),
        abortSignal: abortController.signal,
        fallback: { hold, reply, turnId: result.turn.turnId },
      });
      if (settled.state === "done") {
        return {
          reply: settled.reply,
          turnId: settled.turnId,
          sessionId: session.sessionId,
          settledByLawyer: true,
        };
      }
      if (settled.state === "error") {
        throw new Error(settled.message);
      }
      return {
        reply: settled.reply || reply || "这一步在等你确认。",
        turnId: settled.turnId || result.turn.turnId,
        sessionId: session.sessionId,
        hold: settled.hold,
      };
    } catch (err) {
      abortController.abort();
      throw err;
    }
  })();
  return { sessionId: session.sessionId, done };
}

async function pollCollaborationSession(params: {
  workspaceDir: string;
  sessionId: string;
  deadlineMs: number;
  abortSignal?: AbortSignal;
  fallback: { hold: CollaborationTurnHold; reply: string; turnId: string };
}): Promise<
  | { state: "done"; reply: string; turnId: string }
  | { state: "error"; message: string }
  | { state: "hold"; hold: CollaborationTurnHold; reply: string; turnId: string }
> {
  let latest: { hold: CollaborationTurnHold; reply: string; turnId: string } = params.fallback;
  while (Date.now() < params.deadlineMs) {
    if (params.abortSignal?.aborted) {
      return { state: "error", message: "已停止" };
    }
    const session = loadSession(params.workspaceDir, params.sessionId);
    const read = readCollaborationTurnSettlement(session?.turns);
    if (read.state === "done" || read.state === "error") {
      return read;
    }
    if (read.state === "hold") {
      latest = { hold: read.hold, reply: read.reply, turnId: read.turnId };
    }
    const slice = Math.min(400, params.deadlineMs - Date.now());
    if (slice <= 0) {
      break;
    }
    await delay(slice, params.abortSignal);
  }
  return { state: "hold", ...latest };
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
  /**
   * isolated：只读答复。deliver：工作流已点名改稿/准备外发，走完整回合并预批准这些工具。
   * 咨询和互审保持 isolated。
   */
  execution?: "isolated" | "deliver";
  /**
   * deliver 时生效。只接受模板白名单里的改稿工具，外发仍须律师另批。
   */
  preApproveToolNames?: string[];
  /** 写进子会话，律师稍后回答时能对上这次交办。 */
  delegationId?: string;
  /** 子会话一创建就回调，便于把委派标成进行中。 */
  onSession?: (sessionId: string) => void;
  /** 指令头标签：consult（默认）或 review_request（request_review 专用）。 */
  kind?: "consult" | "review_request";
  permissionMode?: AgentConfig["permissionMode"];
  allowedToolNames?: string[];
  toolSandboxEnabled?: boolean;
  /** 保留签名兼容。工人不走 runTurn，不再分片子回合工具预算。 */
  remainingToolCallBudget?: number;
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

  const title = collaborationSessionTitle(params.kind ?? "consult");
  const instruction = buildCollaborationInstruction({
    kind: params.kind ?? "consult",
    fromAssistantId,
    message,
    deliver: params.execution === "deliver",
  });
  const timeoutMessage = collaborationTimeoutMessage(toAssistantId, timeoutMs);

  if (params.execution === "deliver") {
    const begun = beginDeliverCollaborationTurn({
      baseConfig,
      targetConfig,
      matterId,
      title,
      instruction,
      delegationId: params.delegationId,
      preApproveToolNames: params.preApproveToolNames,
      timeoutMs,
      timeoutMessage,
    });
    params.onSession?.(begun.sessionId);
    return begun.done;
  }

  const agent = createLawMindAgent(targetConfig);
  const session = agent.newSession({
    matterId,
    title,
  });
  session.omitFromChatSwitcher = true;
  const abortController = new AbortController();
  const resultPromise = runIsolatedCollaborationWorker({
    baseConfig: targetConfig,
    sessionId: session.sessionId,
    instruction,
    matterId,
    roleTitle: targetConfig.roleTitle,
    roleDirective: targetConfig.roleDirective,
    abortSignal: abortController.signal,
  });

  let result: Awaited<typeof resultPromise>;
  try {
    result = await withTimeout(resultPromise, timeoutMs, timeoutMessage);
  } catch (err) {
    abortController.abort();
    void resultPromise.catch(() => undefined);
    throw err;
  }

  const now = new Date().toISOString();
  session.conversationHistory.push(
    { role: "user", content: instruction, timestamp: now },
    { role: "assistant", content: result.reply, timestamp: now },
  );
  saveSession(baseConfig.workspaceDir, session);

  return {
    reply: result.reply,
    turnId: randomUUID(),
    sessionId: session.sessionId,
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
  /** 父 turn 剩余工具预算快照；子助手 maxToolCalls 取 min(自身配置, 分片)。 */
  remainingToolCallBudget?: number;
  /** Abort child turn after this many ms (0 = no timer). */
  timeoutMs?: number;
  onTimeout?: (targetSessionId: string) => void;
}): FireAndForgetResult {
  const { baseConfig, fromAssistantId, toAssistantId, message, matterId, kind } = params;
  const delegationId = params.delegationId?.trim() || randomUUID();

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

  const kindResolved = kind ?? "delegate";
  const title = collaborationSessionTitle(kindResolved);
  const instruction = buildCollaborationInstruction({
    kind: kindResolved,
    fromAssistantId,
    message,
    delegateWork: kindResolved === "delegate",
  });

  if (kindResolved === "delegate") {
    const timeoutMs = params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : 300_000;
    const begun = beginDeliverCollaborationTurn({
      baseConfig,
      targetConfig,
      matterId,
      title,
      instruction,
      delegationId,
      timeoutMs,
      timeoutMessage: collaborationTimeoutMessage(toAssistantId, timeoutMs),
    });
    return {
      delegationId,
      targetSessionId: begun.sessionId,
      completion: begun.done,
    };
  }

  const agent = createLawMindAgent(targetConfig);
  const preSession = agent.newSession({
    matterId,
    title,
  });
  preSession.collaborationDelegationId = delegationId;
  preSession.omitFromChatSwitcher = true;
  saveSession(baseConfig.workspaceDir, preSession);
  const targetSessionId = preSession.sessionId;

  const abortController = new AbortController();
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = params.timeoutMs ?? 0;
  if (timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      abortController.abort();
      params.onTimeout?.(targetSessionId);
    }, timeoutMs);
  }

  const completion = runIsolatedCollaborationWorker({
    baseConfig: targetConfig,
    sessionId: targetSessionId,
    instruction,
    matterId,
    roleTitle: targetConfig.roleTitle,
    roleDirective: targetConfig.roleDirective,
    abortSignal: abortController.signal,
  })
    .then((result) => {
      const now = new Date().toISOString();
      preSession.conversationHistory.push(
        { role: "user", content: instruction, timestamp: now },
        { role: "assistant", content: result.reply, timestamp: now },
      );
      saveSession(baseConfig.workspaceDir, preSession);
      return {
        reply: result.reply,
        turnId: randomUUID(),
        sessionId: targetSessionId,
      };
    })
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
function collaborationSessionTitle(kind: CollaborationMessageKind | "consult"): string {
  const labels: Record<string, string> = {
    delegate: "交办",
    consult: "询问",
    notify: "通知",
    review_request: "审阅",
    result: "回传",
  };
  return `协作·${labels[kind] ?? "办理"}`;
}

export function collaborationTimeoutMessage(toAssistantId: string, timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `向「${toAssistantId}」询问已超过 ${seconds} 秒，这一步已停下。请改在当前对话里办理，或稍后再试。`;
}

function buildCollaborationInstruction(params: {
  kind: CollaborationMessageKind | "consult" | "review_request";
  fromAssistantId: string;
  message: string;
  deliver?: boolean;
  /** 交办本身要办完：检索、起草、改稿都在这一步，不再等主办会话补写。 */
  delegateWork?: boolean;
}): string {
  const { kind, fromAssistantId, message } = params;

  const kindLabels: Record<string, string> = {
    delegate: "任务委派",
    consult: "协作咨询",
    notify: "信息通知",
    review_request: "审查请求",
    result: "结果回传",
  };

  const label = kindLabels[kind] ?? kind;
  const closing = params.delegateWork
    ? "请按任务书把这件事办完。可以检索、起草和修改文稿。不要再派给其他助手，不要自行发出邮件。"
    : params.deliver
      ? "请按任务书处理文稿。可以做已预批准的改稿和待确认外发准备。不要再派给其他助手，不要自行发出邮件。"
      : "只根据任务书给出完整回复。不要改原件，不要外发，不要再派给其他助手。落稿由主办会话完成。";

  return `[${label}] 来自助手「${fromAssistantId}」的消息：\n\n${message}\n\n${closing}`;
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
