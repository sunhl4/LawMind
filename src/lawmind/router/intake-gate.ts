/**
 * Intake-first clarification: ask required questions *before* heavy tools run.
 * Used by the agent turn orchestrator so lawyers get a form-like pause
 * instead of mid-flight free chat.
 */

import type { ClarificationQuestion, DeliverableType } from "../types.js";
import { enrichIntentWithDeliverableMeta } from "./deliverable-meta.js";
import { route } from "./keyword-route.js";

const FILLED_INTAKE_RE = /【交办】|交付物类型\s*[：:]|交办要点\s*[：:]/;
/** Lawyer escape hatch: skip intake and proceed to tools / drafting. */
const INTAKE_ESCAPE_RE =
  /继续不澄清|跳过澄清|不用澄清|无需澄清|直接做|直接起草|直接执行|别再问了|不要再澄清/;

export type IntakeGateOptions = {
  /** CASE.md (or similar) already holds parties + deliverable context. */
  caseMemory?: string;
  /** When false, never gate (policy / Doctor / LAWMIND_INTAKE=0). */
  intakeHeuristicsEnabled?: boolean;
};

/** Structured job forms already answered the intake; do not re-ask. */
export function instructionLooksLikeFilledIntake(instruction: string): boolean {
  return FILLED_INTAKE_RE.test(instruction);
}

export function instructionRequestsIntakeEscape(instruction: string): boolean {
  return INTAKE_ESCAPE_RE.test(instruction);
}

/** CASE already documents parties + deliverable shape — skip thin intake. */
export function caseMemoryLooksFilledForIntake(
  caseMemory: string | undefined,
  deliverableType?: DeliverableType,
): boolean {
  const text = caseMemory?.trim() ?? "";
  if (text.length < 40) {
    return false;
  }
  const hasParties = /当事人|甲方|乙方|原告|被告|出租人|承租人|委托人/.test(text);
  const hasType =
    Boolean(deliverableType) || /交付物|文书类型|合同审查|律师函|起诉状|租赁|ESG|意见书/.test(text);
  return hasParties && hasType;
}

export function isIntakeHeuristicsEnabled(
  opts?: IntakeGateOptions,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (opts?.intakeHeuristicsEnabled === false) {
    return false;
  }
  const raw = env.LAWMIND_INTAKE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

/**
 * If this looks like a formal deliverable ask with missing facts, return
 * clarification questions to block heavy tools. Empty = proceed.
 */
export function resolveIntakeClarificationQuestions(
  instruction: string,
  opts?: IntakeGateOptions,
): ClarificationQuestion[] {
  if (!isIntakeHeuristicsEnabled(opts)) {
    return [];
  }
  const text = instruction.trim();
  if (!text || instructionLooksLikeFilledIntake(text) || instructionRequestsIntakeEscape(text)) {
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
  if (caseMemoryLooksFilledForIntake(opts?.caseMemory, intent.deliverableType)) {
    return [];
  }
  return qs;
}

export function deliverableTypeFromInstruction(instruction: string): DeliverableType | undefined {
  return enrichIntentWithDeliverableMeta(route({ instruction: instruction.trim() }))
    .deliverableType;
}
