/**
 * Named inbox channels (DeepSeek send/followup/steer/inject).
 *
 * - followup: POST /api/chat — always a new turn (queued if a turn is live)
 * - steer:    POST /api/sessions/:id/steer — next model round, no new turn
 * - inject:   POST /api/sessions/:id/inject — pins for the next round, no new turn
 *
 * Compose Enter while a turn is running is steer. 「下一轮再发」 is followup.
 */

export const SESSION_INBOX_KINDS = ["followup", "steer", "inject"] as const;

export type SessionInboxKind = (typeof SESSION_INBOX_KINDS)[number];

export type SessionInboxChannel = "chat" | "steer" | "inject";

export function classifySessionInbox(channel: SessionInboxChannel): SessionInboxKind {
  if (channel === "steer") {
    return "steer";
  }
  if (channel === "inject") {
    return "inject";
  }
  return "followup";
}

export function isSessionInboxKind(raw: unknown): raw is SessionInboxKind {
  return raw === "followup" || raw === "steer" || raw === "inject";
}
