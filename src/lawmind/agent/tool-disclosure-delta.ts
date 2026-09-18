/**
 * When the advertised OpenAI tool set changes mid-turn (list_more_tools,
 * pin packs, permission), append a hidden transcript note so the next sample
 * and auditors see the delta — Pi-style toolsAdded / toolsRemoved.
 */

import type { AgentMessage, AgentSession } from "./types.js";

export type ToolNameDelta = {
  added: string[];
  removed: string[];
};

export function diffToolNames(previous: string[], next: string[]): ToolNameDelta {
  const prev = new Set(previous);
  const nxt = new Set(next);
  const added = next.filter((name) => !prev.has(name));
  const removed = previous.filter((name) => !nxt.has(name));
  return { added, removed };
}

export function formatToolDisclosureDeltaNote(delta: ToolNameDelta): string | null {
  if (delta.added.length === 0 && delta.removed.length === 0) {
    return null;
  }
  const lines: string[] = ["【工具声明变更】本轮模型可见工具集已更新（对律师气泡隐藏）。"];
  if (delta.added.length > 0) {
    lines.push(`新增：${delta.added.join(", ")}`);
  }
  if (delta.removed.length > 0) {
    lines.push(`移除：${delta.removed.join(", ")}`);
  }
  return lines.join("\n");
}

/** Append hidden user note when tool names changed vs the previous model round. */
export function applyToolDisclosureDelta(
  session: AgentSession,
  previousNames: string[] | null,
  nextNames: string[],
): ToolNameDelta | null {
  if (previousNames === null) {
    return null;
  }
  const delta = diffToolNames(previousNames, nextNames);
  const note = formatToolDisclosureDeltaNote(delta);
  if (!note) {
    return null;
  }
  const msg: AgentMessage = {
    role: "user",
    content: note,
    timestamp: new Date().toISOString(),
    hiddenFromLawyer: true,
  };
  session.conversationHistory.push(msg);
  return delta;
}
