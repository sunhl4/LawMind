/**
 * Dual-write inspector: conversationHistory (model + UI source) vs
 * events.jsonl / turns.jsonl sidecars. Detects refresh/resume drift.
 * Does not change the projection — deriveModelMessages stays the sampler path.
 */

import { readSessionEvents, type SessionEventLogRecord } from "./session-event-log.js";
import { findUnpairedToolCallIds } from "./session-tool-call-pairing.js";
import { deriveModelMessages, loadTurns } from "./session.js";
import type { AgentSession, AgentTurn } from "./types.js";

export type SessionHistoryAlignmentIssue = {
  code:
    | "derive_len"
    | "derive_role"
    | "final_reply_mismatch"
    | "turn_instruction_missing"
    | "dangling_tool_call";
  detail: string;
};

export type SessionHistoryAlignment = {
  ok: boolean;
  issues: SessionHistoryAlignmentIssue[];
};

function lastTurnEvents(records: SessionEventLogRecord[]): SessionEventLogRecord[] {
  let start = 0;
  for (let i = 0; i < records.length; i++) {
    if (records[i]?.event.type === "turn_begin") {
      start = i;
    }
  }
  return records.slice(start);
}

export function inspectSessionHistoryAlignment(input: {
  session: AgentSession;
  events?: SessionEventLogRecord[];
  turns?: AgentTurn[];
}): SessionHistoryAlignment {
  const issues: SessionHistoryAlignmentIssue[] = [];
  // 必须在 deriveModelMessages 之前检查：derive 会对悬空 tool_call 做配对修复并写回
  // session，之后再看就永远是已修复序列。此处观测的是「落盘历史原本是否配对」。
  const dangling = findUnpairedToolCallIds(input.session.conversationHistory);
  if (dangling.length > 0) {
    issues.push({
      code: "dangling_tool_call",
      detail: `unpaired tool_calls: ${dangling.slice(0, 5).join(",")}${dangling.length > 5 ? "…" : ""}`,
    });
  }
  const derived = deriveModelMessages(input.session);
  const history = input.session.conversationHistory;
  if (derived.length !== history.length) {
    issues.push({
      code: "derive_len",
      detail: `derive=${derived.length} history=${history.length}`,
    });
  }
  const bound = Math.min(derived.length, history.length);
  for (let i = 0; i < bound; i++) {
    if (derived[i]?.role !== history[i]?.role) {
      issues.push({
        code: "derive_role",
        detail: `index ${i}: derive=${derived[i]?.role ?? "?"} history=${history[i]?.role ?? "?"}`,
      });
      break;
    }
  }

  const lastEvents = lastTurnEvents(input.events ?? []);
  const finals = lastEvents.filter((row) => row.event.type === "final");
  const lastFinal = finals[finals.length - 1];
  if (lastFinal?.event.type === "final" && lastFinal.event.status === "completed") {
    const reply = lastFinal.event.reply.trim();
    if (reply) {
      const lastAsst = [...history].toReversed().find((msg) => msg.role === "assistant");
      const text = (lastAsst?.content ?? "").trim();
      if (text && text !== reply && !text.includes(reply) && !reply.includes(text)) {
        issues.push({
          code: "final_reply_mismatch",
          detail: "events.jsonl final reply ≠ session.json last assistant",
        });
      }
    }
  }

  const lastTurn = input.turns?.[input.turns.length - 1];
  const instruction = lastTurn?.instruction?.trim() ?? "";
  if (instruction) {
    const hasUser = history.some(
      (msg) => msg.role === "user" && (msg.content ?? "").includes(instruction),
    );
    if (!hasUser) {
      issues.push({
        code: "turn_instruction_missing",
        detail: lastTurn?.turnId ?? "unknown",
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

export function inspectPersistedSessionHistoryAlignment(
  workspaceDir: string,
  session: AgentSession,
): SessionHistoryAlignment {
  return inspectSessionHistoryAlignment({
    session,
    events: readSessionEvents(workspaceDir, session.sessionId),
    turns: loadTurns(workspaceDir, session.sessionId),
  });
}
