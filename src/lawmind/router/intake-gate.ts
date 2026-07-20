/**
 * Intake-first clarification: ask required questions *before* heavy tools run.
 * Used by the agent turn orchestrator so lawyers get a form-like pause
 * instead of mid-flight free chat.
 */

import type { ClarificationQuestion, DeliverableType } from "../types.js";
import { enrichIntentWithDeliverableMeta } from "./deliverable-meta.js";
import { route } from "./keyword-route.js";

const FILLED_INTAKE_RE = /【交办】|交付物类型\s*[：:]|交办要点\s*[：:]/;

/** Structured job forms already answered the intake; do not re-ask. */
export function instructionLooksLikeFilledIntake(instruction: string): boolean {
  return FILLED_INTAKE_RE.test(instruction);
}

/**
 * If this looks like a formal deliverable ask with missing facts, return
 * clarification questions to block heavy tools. Empty = proceed.
 */
export function resolveIntakeClarificationQuestions(instruction: string): ClarificationQuestion[] {
  const text = instruction.trim();
  if (!text || instructionLooksLikeFilledIntake(text)) {
    return [];
  }
  // Short Q&A / identity checks should not trigger intake.
  if (text.length < 4) {
    return [];
  }
  const intent = enrichIntentWithDeliverableMeta(route({ instruction: text }));
  const qs = intent.clarificationQuestions ?? [];
  if (qs.length === 0) {
    return [];
  }
  // Only gate when we actually detected a deliverable type worth structuring.
  if (!intent.deliverableType) {
    return [];
  }
  return qs;
}

export function deliverableTypeFromInstruction(instruction: string): DeliverableType | undefined {
  return enrichIntentWithDeliverableMeta(route({ instruction: instruction.trim() }))
    .deliverableType;
}
