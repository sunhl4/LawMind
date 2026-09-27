/**
 * 助手头像六态。状态从已有办件推导，不在对话里再铺一层过程芯片。
 *
 * 多件并存时取更需要律师看见的那一态：停住 > 等你看 > 在办 > 在想 > 刚办完 > 空闲。
 */

import type { LawyerWorkStatus } from "../work/types.js";

export type AssistantPresence = "idle" | "working" | "waiting" | "blocked" | "thinking" | "done";

export const ASSISTANT_PRESENCE_LABEL: Record<AssistantPresence, string> = {
  idle: "空闲",
  working: "在办",
  waiting: "等你看",
  blocked: "停住了",
  thinking: "在想",
  done: "刚办完",
};

const RANK: Record<AssistantPresence, number> = {
  idle: 0,
  done: 1,
  thinking: 2,
  working: 3,
  waiting: 4,
  blocked: 5,
};

const DONE_VISIBLE_MS = 24 * 60 * 60 * 1000;

export function presenceFromWork(
  status: LawyerWorkStatus,
  updatedAt: string,
  nowMs: number,
): AssistantPresence {
  if (status === "needs_lawyer" || status === "rejected") {
    return "blocked";
  }
  if (status === "needs_signoff") {
    return "waiting";
  }
  if (status === "running") {
    return "working";
  }
  if (status === "open") {
    return "thinking";
  }
  const updated = Date.parse(updatedAt);
  if (status === "done" && Number.isFinite(updated) && nowMs - updated < DONE_VISIBLE_MS) {
    return "done";
  }
  return "idle";
}

export function strongerPresence(
  current: AssistantPresence,
  next: AssistantPresence,
): AssistantPresence {
  return RANK[next] > RANK[current] ? next : current;
}

export type AssistantPresenceView = {
  presence: AssistantPresence;
  /** 这一态对应的办件标题，给顶栏悬停看一行。 */
  detail?: string;
};

export function notePresence(
  current: AssistantPresenceView | undefined,
  next: AssistantPresence,
  detail: string,
): AssistantPresenceView {
  if (!current || RANK[next] > RANK[current.presence]) {
    return { presence: next, detail: detail.trim() || undefined };
  }
  return current;
}
