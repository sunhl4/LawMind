/**
 * One embed contract: Desktop HTTP + SSE is the App Server.
 * Chat, resume, second window, and live-turn all speak RunTurnEvent types.
 * Job/automation SSE is `{ ok, job }` snapshots — not a second turn dialect.
 */

import type { RunTurnEvent } from "./turn-orchestrator-events.js";

export const EMBED_TURN_EVENT_TYPES = [
  "round_start",
  "tool_call_start",
  "tool_call_end",
  "tool_progress",
  "delta",
  "clarification",
  "final",
  "token_budget",
  "tool_budget",
  "compact_boundary",
  "overflow_prune",
  "requires_action",
] as const satisfies ReadonlyArray<RunTurnEvent["type"]>;

export type EmbedTurnEventType = (typeof EMBED_TURN_EVENT_TYPES)[number];

/** SSE event name = RunTurnEvent.type. `final_reply` is a legacy alias of `final`. */
export function embedSseEventName(type: RunTurnEvent["type"]): EmbedTurnEventType {
  return type;
}

export const LEGACY_FINAL_SSE_ALIAS = "final_reply";

export const MAX_LIVE_TURN_STEPS = 80;
