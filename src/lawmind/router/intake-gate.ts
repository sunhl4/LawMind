/**
 * Intake clarification: Soft Ask by default; hard-gate only high-risk empty runs.
 */

import { isMailContractFastPathInstruction } from "../platform/mail-contract-short-path-instruction.js";
import { isWordRevisionInstruction } from "../platform/word-revision-instruction.js";
import type { ClarificationQuestion, DeliverableType } from "../types.js";
import { enrichIntentWithDeliverableMeta } from "./deliverable-meta.js";
import { route } from "./keyword-route.js";

const FILLED_INTAKE_RE = /【交办】|【办件】|交付物类型\s*[：:]|交办要点\s*[：:]/;
/** Lawyer escape hatch: skip intake and proceed to tools / drafting. */
const INTAKE_ESCAPE_RE =
  /继续不澄清|跳过澄清|不用澄清|无需澄清|直接做|直接起草|直接执行|别再问了|不要再澄清/;

/** Paths / pins already in the instruction — treat as materials present. */
const PINNED_MATERIALS_RE =
  /contract_edit_baseline_path\s*=|cases\/[^\s`]+\/mail\/attachments\/|contextPins|@\s*(?:file|evidence|clause|playbook)|钉选|附件路径|baselineRelativePath|LawMind 文件页/i;

export type IntakeGateOptions = {
  /** CASE.md (or similar) already holds parties + deliverable context. */
  caseMemory?: string;
  /** When false, never gate (policy / Doctor / LAWMIND_INTAKE=0). */
  intakeHeuristicsEnabled?: boolean;
  /** Session compose pins — non-empty skips hard intake. */
  hasContextPins?: boolean;
};

/** Structured job forms already answered the intake; do not re-ask. */
export function instructionLooksLikeFilledIntake(instruction: string): boolean {
  return FILLED_INTAKE_RE.test(instruction);
}

export function instructionRequestsIntakeEscape(instruction: string): boolean {
  return INTAKE_ESCAPE_RE.test(instruction);
}

export function instructionHasPinnedMaterials(instruction: string): boolean {
  return PINNED_MATERIALS_RE.test(instruction);
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

function shouldSkipAllIntake(instruction: string, opts?: IntakeGateOptions): boolean {
  if (!isIntakeHeuristicsEnabled(opts)) {
    return true;
  }
  const text = instruction.trim();
  if (!text || text.length < 4) {
    return true;
  }
  if (instructionLooksLikeFilledIntake(text) || instructionRequestsIntakeEscape(text)) {
    return true;
  }
  if (
    isMailContractFastPathInstruction(text) ||
    isWordRevisionInstruction(text) ||
    instructionHasPinnedMaterials(text)
  ) {
    return true;
  }
  if (opts?.hasContextPins) {
    return true;
  }
  return false;
}

function collectMetaQuestions(instruction: string): {
  deliverableType?: DeliverableType;
  questions: ClarificationQuestion[];
} {
  const intent = enrichIntentWithDeliverableMeta(route({ instruction }));
  return {
    deliverableType: intent.deliverableType,
    questions: intent.clarificationQuestions ?? [],
  };
}

function isHighRiskEmptyRunType(type: DeliverableType | undefined): boolean {
  return (
    type === "letter.demand" ||
    type === "letter.counsel" ||
    type === "letter.reply" ||
    type === "litigation.outline" ||
    type === "litigation.complaint" ||
    type === "litigation.answer" ||
    type === "litigation.brief"
  );
}

/**
 * Soft Ask questions for system prompt — do not freeze the turn.
 */
export function resolveIntakeAdvisoryQuestions(
  instruction: string,
  opts?: IntakeGateOptions,
): ClarificationQuestion[] {
  if (shouldSkipAllIntake(instruction, opts)) {
    return [];
  }
  const { deliverableType, questions } = collectMetaQuestions(instruction);
  if (!deliverableType || questions.length === 0) {
    return [];
  }
  if (caseMemoryLooksFilledForIntake(opts?.caseMemory, deliverableType)) {
    return [];
  }
  // High-risk empty runs use hard gate instead (see resolveIntakeClarificationQuestions).
  if (isHighRiskEmptyRunType(deliverableType)) {
    return [];
  }
  return questions;
}

/**
 * Hard intake questions that pause the turn (high-risk + no materials only).
 */
export function resolveIntakeClarificationQuestions(
  instruction: string,
  opts?: IntakeGateOptions,
): ClarificationQuestion[] {
  if (shouldSkipAllIntake(instruction, opts)) {
    return [];
  }
  const { deliverableType, questions } = collectMetaQuestions(instruction);
  if (!deliverableType || questions.length === 0) {
    return [];
  }
  if (caseMemoryLooksFilledForIntake(opts?.caseMemory, deliverableType)) {
    return [];
  }
  if (!isHighRiskEmptyRunType(deliverableType)) {
    return [];
  }
  return questions;
}

export function deliverableTypeFromInstruction(instruction: string): DeliverableType | undefined {
  return enrichIntentWithDeliverableMeta(route({ instruction: instruction.trim() }))
    .deliverableType;
}
