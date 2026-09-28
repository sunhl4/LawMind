/**
 * Lawyer transcript: one typed utterance, one answer window.
 *
 * Model history keeps every round (tool calls, compact anchors, bounce notes).
 * The desktop bubbles do not. Synthetic user notes stay off-screen. Status
 * lines the model writes before the next tool stay in history for the model;
 * the lawyer sees the prose that follows the last tool round, in one bubble.
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

/**
 * Drop digest inventory the model may echo. Lawyers see the answer; tool lists
 * stay in `cases/.../compact-digest.md` for developers.
 */
export function scrubLawyerFacingAssistantText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .replace(/\n*###\s*曾调用工具\s*\n[\s\S]*?(?=\n###\s|\s*$)/g, "")
    .replace(/\n*###\s*压缩前引用\s*\n[\s\S]*?(?=\n###\s|\s*$)/g, "")
    .trim();
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

/**
 * Prose after the last tool round. Narration that sits on a tool call is process,
 * same as Codex keeping tool rounds in the model transcript and showing one answer.
 */
function lawyerAnswerText(
  history: readonly AgentMessage[],
  visible: Array<{ msg: AgentMessage; index: number }>,
): string {
  let lastToolRound = -1;
  for (let i = 0; i < visible.length; i += 1) {
    const row = visible[i];
    const next = visible[i + 1];
    if (!row) {
      continue;
    }
    const calledTools = (row.msg.toolCalls?.length ?? 0) > 0;
    const toolBeforeNext = next
      ? history.slice(row.index + 1, next.index).some((msg) => msg?.role === "tool")
      : false;
    if (calledTools || toolBeforeNext) {
      lastToolRound = i;
    }
  }
  return scrubLawyerFacingAssistantText(
    visible
      .slice(lastToolRound + 1)
      .map((row) => (row.msg.content ?? "").trim())
      .filter((text) => text.length > 0)
      .join("\n\n"),
  );
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
    bubbles.push({
      role: "assistant",
      text: lawyerAnswerText(history, visible),
      historyIndex: first.index,
      historyEndExclusive: assistantSpanEnd(history, last.index, nextBoundary),
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
