/**
 * Agent turn loop state + structured stop reasons.
 *
 * Before this module, "why did the turn stop?" was only recoverable from the
 * Chinese reply text and from reading the loop. The loop now writes a
 * {@link TurnStopReason} (plus `roundCount`) onto the persisted turn, so
 * replay/observability can aggregate by cause instead of by prose.
 *
 * Pure data: no I/O, no model calls.
 */

/**
 * Why the model/tool loop returned. Keep stable — persisted in
 * `sessions/<id>.turns.jsonl` and consumed by `evaluation/turn-loop-replay.ts`.
 */
export type TurnStopReason =
  /** Model produced a closing reply with no tool calls. */
  | "delivered"
  /**
   * Prose-syndrome machine note replaced the closing reply.
   * Unreachable today (`applyProseSyndrome` always returns `none`); kept so the
   * policy table does not silently change cause if that detector is enabled.
   */
  | "prose_syndrome"
  /** Delivered together with non-blocking clarification gaps (draft_with_placeholders). */
  | "clarification_delivered"
  /** Same-turn validators still red and the bounce budget is exhausted. */
  | "verify_cap"
  /** A verifier itself declared "stop and hand the gaps to the lawyer". */
  | "gate_stop"
  /** Model asked the lawyer to "open another round" and handoff was the honest close. */
  | "deferral_handoff"
  /** Tool-call budget hard ceiling. */
  | "tool_budget"
  /** The model/tool while-loop exhausted its round ceiling. */
  | "round_ceiling"
  /** Identical tool batch repeated past the nudge. */
  | "repeat_stop"
  /** Repeated read of an already-finished document (Word revision special case). */
  | "reread_stop"
  /** Forbidden shell retried past the nudge. */
  | "forbidden_shell"
  /** Tool asked for lawyer approval — turn pauses. */
  | "awaiting_approval"
  /** Tool asked a blocking question — turn pauses. */
  | "awaiting_clarification"
  /** Model HTTP/network failure closed the turn. */
  | "model_error"
  /** Lawyer pressed Stop. */
  | "aborted"
  /** Loop exited without any branch claiming the stop (defensive). */
  | "unknown";

/** Coarse buckets for replay rollups. */
export type TurnStopBucket =
  | "delivered"
  | "needs_lawyer"
  | "budget"
  /** Model-behavior guards: repeated batch, finished reread, forbidden shell. */
  | "loop_guard"
  | "model_error"
  | "aborted"
  | "unknown";

export function stopReasonBucket(reason: TurnStopReason | undefined): TurnStopBucket {
  switch (reason) {
    case "delivered":
    case "prose_syndrome":
    case "clarification_delivered":
      return "delivered";
    case "verify_cap":
    case "gate_stop":
    case "deferral_handoff":
      // 缺口已如实交律师，但不是一次干净交付。
      return "needs_lawyer";
    case "awaiting_approval":
    case "awaiting_clarification":
      return "needs_lawyer";
    case "tool_budget":
    case "round_ceiling":
      return "budget";
    case "repeat_stop":
    case "reread_stop":
    case "forbidden_shell":
      return "loop_guard";
    case "model_error":
      return "model_error";
    case "aborted":
      return "aborted";
    default:
      return "unknown";
  }
}

/**
 * One-shot per-turn flags that used to be a dozen sibling `let`s inside the
 * model loop. Grouping them makes the policy table stateless to read and lets
 * tests assert the whole set at once.
 */
export type LoopFlags = {
  /** Soft warn near the tool-call ceiling was already emitted. */
  toolBudgetWarned: boolean;
  /** Context-overflow prune retried once. */
  overflowRetryUsed: boolean;
  /** Empty `choices[]` retried once. */
  emptyChoiceRetryUsed: boolean;
  /** Write-synthesis coach fired; search stays locked while the file is missing. */
  synthesisNudged: boolean;
  synthesisSearchLocked: boolean;
  /** Missing-named-deliverable coach fired. */
  deliverableNudged: boolean;
  /** Calculate param-stop coach fired. */
  calculateParamNudged: boolean;
  /** Pleading / memo / consult section coaches fired. */
  pleadingNudged: boolean;
  memoNudged: boolean;
  consultNudged: boolean;
  /** One extra sample after a finished Word-revision reread. */
  documentRereadContinued: boolean;
  /** Word revision export coach fired. */
  wordRevisionExportNudged: boolean;
  /** Review-board export deferral bounces used this turn. */
  reviewBoardExportBounces: number;
  /** Forbidden shell coach fired. */
  forbiddenShellNudged: boolean;
  /** Consecutive identical tool batches. */
  identicalToolStreak: IdenticalToolStreak | null;
};

export type IdenticalToolStreak = {
  signature: string;
  streak: number;
  nudged: boolean;
};

export function createLoopFlags(): LoopFlags {
  return {
    toolBudgetWarned: false,
    overflowRetryUsed: false,
    emptyChoiceRetryUsed: false,
    synthesisNudged: false,
    synthesisSearchLocked: false,
    deliverableNudged: false,
    calculateParamNudged: false,
    pleadingNudged: false,
    memoNudged: false,
    consultNudged: false,
    documentRereadContinued: false,
    wordRevisionExportNudged: false,
    reviewBoardExportBounces: 0,
    forbiddenShellNudged: false,
    identicalToolStreak: null,
  };
}
