/**
 * Main model ↔ tool loop for runTurn (extracted from turn-orchestrator).
 */

import {
  mergeUsageSnapshots,
  usageFromProvider,
  type ModelUsageSnapshot,
} from "../models/model-usage.js";
import type { ToolCallRef } from "../runtime/tool-concurrency.js";
import type { ClarificationQuestion } from "../types.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import { toModelMessages } from "./session.js";
import type { ToolRegistry } from "./tools/registry.js";
import {
  buildClarificationReply,
  buildTurnReplyFallback,
  safeParse,
  type RunTurnEvent,
} from "./turn-orchestrator-events.js";
import { executeToolBatches, type ToolRoundPolicyHints } from "./turn-orchestrator-tool-round.js";
import type { AgentConfig, AgentContext, AgentMessage, AgentSession, AgentTurn } from "./types.js";

/**
 * Strict tool streaming is opt-in (D3): desktop/SSE defaults relaxed so tool_calls
 * can arrive without forcing upstream stream constraints. Set LAWMIND_STRICT_TOOL_STREAM=1 to enable.
 */
export function resolveStrictUpstreamToolStreaming(
  hasOnEvent: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!hasOnEvent) {
    return false;
  }
  const raw = env.LAWMIND_STRICT_TOOL_STREAM?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "on";
}

export type ModelToolLoopResult = {
  finalReply: string;
  pendingClarificationQuestions: ClarificationQuestion[];
  turnUsage: ModelUsageSnapshot | undefined;
  aborted: boolean;
};

/**
 * Run model → tools until completion, approval, abort, or tool-call ceiling.
 */
export async function runModelToolLoop(opts: {
  config: AgentConfig;
  registry: ToolRegistry;
  session: AgentSession;
  turn: AgentTurn;
  ctx: AgentContext;
  openAITools: ReturnType<ToolRegistry["toOpenAITools"]>;
  maxToolCalls: number;
  toolTimeoutMs: number;
  strictDangerousToolApproval: boolean;
  allowDangerousToolsWithoutApproval: boolean;
  toolSandboxEnabled: boolean;
  policyHints: ToolRoundPolicyHints;
  actorId: string;
  hasOnEvent: boolean;
  pendingClarificationQuestions: ClarificationQuestion[];
  emitEvent: (event: RunTurnEvent) => void;
  abortRequested: () => boolean;
  /** Aborts in-flight model HTTP when Stop is pressed. */
  abortSignal?: AbortSignal;
}): Promise<ModelToolLoopResult> {
  let loopCount = 0;
  let turnUsage: ModelUsageSnapshot | undefined;
  let finalReply = "";
  let pendingClarificationQuestions = opts.pendingClarificationQuestions;

  const strictUpstreamToolStreaming = resolveStrictUpstreamToolStreaming(opts.hasOnEvent);

  while (loopCount < opts.maxToolCalls + 1) {
    if (opts.abortRequested() || opts.abortSignal?.aborted) {
      return {
        finalReply,
        pendingClarificationQuestions,
        turnUsage,
        aborted: true,
      };
    }
    loopCount++;
    const roundIndex = loopCount;
    opts.emitEvent({ type: "round_start", roundIndex });

    const modelMessages = toModelMessages(opts.session);
    const hadToolResponsesThisTurn = opts.turn.messages.some((m) => m.role === "tool");
    const useUpstreamTokenStream =
      opts.hasOnEvent &&
      (!strictUpstreamToolStreaming || opts.openAITools.length === 0 || hadToolResponsesThisTurn);

    // E7: tool rounds prefer workerModel when configured; final no-tool reply uses primary.
    const modelForRound =
      opts.openAITools.length > 0 && opts.config.workerModel
        ? opts.config.workerModel
        : opts.config.model;

    let response: Awaited<ReturnType<typeof callModelWithRetry>>;
    try {
      response = await callModelWithRetry(modelForRound, modelMessages, opts.openAITools, {
        stream: useUpstreamTokenStream,
        onDelta: useUpstreamTokenStream
          ? (chunk: string) => opts.emitEvent({ type: "delta", roundIndex, text: chunk })
          : undefined,
        signal: opts.abortSignal,
      });
    } catch (err) {
      if (
        err instanceof ModelCallUserAbortError ||
        opts.abortSignal?.aborted ||
        opts.abortRequested()
      ) {
        return {
          finalReply,
          pendingClarificationQuestions,
          turnUsage,
          aborted: true,
        };
      }
      throw err;
    }
    turnUsage = mergeUsageSnapshots(turnUsage, usageFromProvider(response.usage));

    const choice = response.choices[0];
    if (!choice) {
      opts.turn.status = "error";
      opts.turn.error = "Empty response from model";
      break;
    }

    const assistantMsg = choice.message;
    const toolCalls = assistantMsg.tool_calls;

    if (!useUpstreamTokenStream) {
      const segment = assistantMsg.content ?? "";
      if (segment.length > 0) {
        opts.emitEvent({ type: "delta", roundIndex, text: segment });
      }
    }

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

    opts.session.conversationHistory.push(agentMsg);
    opts.turn.messages.push(agentMsg);

    if (!toolCalls || toolCalls.length === 0) {
      if (pendingClarificationQuestions.length > 0) {
        finalReply = buildClarificationReply(
          assistantMsg.content ?? "",
          pendingClarificationQuestions,
        );
        opts.turn.status = "awaiting_clarification";
        opts.turn.clarificationQuestions = pendingClarificationQuestions;
      } else {
        finalReply = assistantMsg.content ?? "";
        opts.turn.status = "completed";
      }
      break;
    }

    const toolRefs: ToolCallRef[] = toolCalls.map(
      (tc: { id: string; function: { name: string; arguments: string } }) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParse(tc.function.arguments),
      }),
    );
    const batchResult = await executeToolBatches({
      toolRefs,
      registry: opts.registry,
      turn: opts.turn,
      ctx: opts.ctx,
      roundIndex,
      assistantContent: assistantMsg.content ?? "",
      maxToolCalls: opts.maxToolCalls,
      toolTimeoutMs: opts.toolTimeoutMs,
      strictDangerousToolApproval: opts.strictDangerousToolApproval,
      allowDangerousToolsWithoutApproval: opts.allowDangerousToolsWithoutApproval,
      toolSandboxEnabled: opts.toolSandboxEnabled,
      policyHints: opts.policyHints,
      actorId: opts.actorId,
      sessionMatterId: opts.session.matterId,
      sessionAssistantId: opts.session.assistantId,
      pendingClarificationQuestions,
      emitEvent: opts.emitEvent,
      pushMessage: (msg) => {
        opts.session.conversationHistory.push(msg);
        opts.turn.messages.push(msg);
      },
    });
    pendingClarificationQuestions = batchResult.pendingClarificationQuestions;
    if (batchResult.finalReply) {
      finalReply = batchResult.finalReply;
    }

    if (opts.turn.status === "awaiting_approval") {
      break;
    }

    if (opts.turn.toolCallsExecuted >= opts.maxToolCalls) {
      if (pendingClarificationQuestions.length > 0) {
        opts.turn.status = "awaiting_clarification";
        opts.turn.clarificationQuestions = pendingClarificationQuestions;
        finalReply = buildClarificationReply(
          assistantMsg.content ?? "",
          pendingClarificationQuestions,
          "已生成带待补充项的正式草稿，但当前轮次已达到工具调用上限。为完成最终交付，请补充：",
        );
      } else {
        opts.turn.status = "completed";
        finalReply = assistantMsg.content ?? "已达到工具调用上限。";
      }
      break;
    }
  }

  if (!finalReply.trim() && opts.turn.toolCallsExecuted > 0) {
    finalReply = buildTurnReplyFallback(opts.turn);
  }

  return {
    finalReply,
    pendingClarificationQuestions,
    turnUsage,
    aborted: false,
  };
}
