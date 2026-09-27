/**
 * Lawyer transcript: one typed utterance, one answer window.
 *
 * Model history keeps every round (tool calls, compact anchors, bounce notes).
 * The desktop bubbles do not: synthetic user notes stay off-screen, and the
 * assistant texts of a single user turn share one window.
 */

import { isCompactSyntheticUserMessage } from "./compact-insert.js";
import type { AgentMessage, PersistedChatLiveTrace } from "./types.js";

export type LawyerChatBubble = {
  role: "user" | "assistant";
  text: string;
  /** First conversationHistory index that belongs to this bubble. */
  historyIndex: number;
  /** Exclusive end. Trailing tool rows of an answer are included; the next user message is not. */
  historyEndExclusive: number;
  liveTrace?: PersistedChatLiveTrace;
  executionState?: AgentMessage["executionState"];
  turnPlan?: AgentMessage["turnPlan"];
};

function lawyerTypedText(msg: AgentMessage): string {
  const typed = msg.lawyerVisibleText?.trim();
  if (typed) {
    return typed;
  }
  return (msg.content ?? "").trim();
}

/** A user row the lawyer actually sent. Compact anchors and bounce notes are not. */
export function isLawyerTypedUserMessage(msg: AgentMessage): boolean {
  if (msg.role !== "user" || msg.hiddenFromLawyer) {
    return false;
  }
  if (isCompactSyntheticUserMessage(msg.content ?? "")) {
    return false;
  }
  return lawyerTypedText(msg).length > 0;
}

function assistantContributesToBubble(msg: AgentMessage): boolean {
  if (msg.role !== "assistant" || msg.hiddenFromLawyer) {
    return false;
  }
  const text = (msg.content ?? "").trim();
  return text.length > 0 || (msg.liveTrace?.steps?.length ?? 0) > 0 || msg.turnPlan != null;
}

function mergeLiveTraces(messages: AgentMessage[]): PersistedChatLiveTrace | undefined {
  const traces = messages.flatMap((msg) => (msg.liveTrace ? [msg.liveTrace] : []));
  if (traces.length === 0) {
    return undefined;
  }
  let currentRound: number | undefined;
  for (const trace of traces) {
    if (trace.currentRound != null) {
      currentRound = trace.currentRound;
    }
  }
  return {
    steps: traces.flatMap((trace) => trace.steps),
    ...(currentRound != null ? { currentRound } : {}),
  };
}

/** Stop before the next user row so a compact note sitting in front of it is kept for the model. */
function assistantSpanEnd(
  history: readonly AgentMessage[],
  lastAssistantIndex: number,
  nextBoundary: number,
): number {
  let end = lastAssistantIndex + 1;
  while (end < nextBoundary) {
    const msg = history[end];
    if (!msg || msg.role === "user") {
      break;
    }
    end += 1;
  }
  return end;
}

/**
 * Pair the persisted history into desktop bubbles.
 * Consecutive assistant rounds after one typed user message become one bubble.
 * The next typed user message starts a new pair, so two questions never share one answer.
 */
export function projectLawyerChatBubbles(history: readonly AgentMessage[]): LawyerChatBubble[] {
  const bubbles: LawyerChatBubble[] = [];
  let run: Array<{ msg: AgentMessage; index: number }> = [];

  const flush = (nextBoundary: number): void => {
    const visible = run.filter((row) => assistantContributesToBubble(row.msg));
    run = [];
    if (visible.length === 0) {
      return;
    }
    const first = visible[0];
    const last = visible[visible.length - 1];
    if (!first || !last) {
      return;
    }
    const texts = visible
      .map((row) => (row.msg.content ?? "").trim())
      .filter((text) => text.length > 0);
    let executionState: AgentMessage["executionState"];
    let turnPlan: AgentMessage["turnPlan"];
    for (const row of visible) {
      if (row.msg.executionState) {
        executionState = row.msg.executionState;
      }
      if (row.msg.turnPlan) {
        turnPlan = row.msg.turnPlan;
      }
    }
    const liveTrace = mergeLiveTraces(visible.map((row) => row.msg));
    bubbles.push({
      role: "assistant",
      text: texts.join("\n\n"),
      historyIndex: first.index,
      historyEndExclusive: assistantSpanEnd(history, last.index, nextBoundary),
      ...(liveTrace ? { liveTrace } : {}),
      ...(executionState ? { executionState } : {}),
      ...(turnPlan ? { turnPlan } : {}),
    });
  };

  for (let index = 0; index < history.length; index += 1) {
    const msg = history[index];
    if (!msg) {
      continue;
    }
    if (isLawyerTypedUserMessage(msg)) {
      flush(index);
      bubbles.push({
        role: "user",
        text: lawyerTypedText(msg),
        historyIndex: index,
        historyEndExclusive: index + 1,
      });
      continue;
    }
    if (msg.role === "assistant" && !msg.hiddenFromLawyer) {
      run.push({ msg, index });
    }
  }
  flush(history.length);
  return bubbles;
}
