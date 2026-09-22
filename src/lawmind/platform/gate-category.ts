/**
 * Map platform gates to safety_hard vs judgment_soft for audit / Doctor.
 */

import type { GateCategory, GateDecision } from "./contracts.js";

const SAFETY_HARD_GATES = new Set<GateDecision["gate"]>([
  "dangerous_tool_gate",
  "approval_gate",
  "acceptance_gate",
  "redline_hunks_gate",
  "surgical_span_gate",
  "outbound_privilege_gate",
  "outbound_recipient_gate",
]);

/**
 * Default category when callers omit `category`.
 * Intake hard freeze (awaiting_confirmation/block) stays safety_hard;
 * intake allow / advisory notes are judgment_soft.
 */
export function resolveGateCategory(gate: GateDecision): GateCategory {
  if (gate.category === "safety_hard" || gate.category === "judgment_soft") {
    return gate.category;
  }
  if (gate.gate === "reasoning_gate") {
    // Soft craft / amplitude coaching uses decision=allow + judgment_soft.
    if (gate.decision === "allow") {
      return "judgment_soft";
    }
    return "safety_hard";
  }
  if (SAFETY_HARD_GATES.has(gate.gate)) {
    return "safety_hard";
  }
  if (gate.gate === "intake_gate") {
    if (gate.decision === "allow") {
      return "judgment_soft";
    }
    // Hard clarification (letter.demand / litigation without materials) remains safety.
    return "safety_hard";
  }
  if (gate.gate === "clarification_gate") {
    // Tool-returned clarificationQuestions still freeze writes — safety.
    return "safety_hard";
  }
  return "judgment_soft";
}

export function withGateCategory(gate: GateDecision): GateDecision {
  return { ...gate, category: resolveGateCategory(gate) };
}

export function withGateCategories(gates: GateDecision[] | undefined | null): GateDecision[] {
  if (!gates?.length) {
    return [];
  }
  return gates.map(withGateCategory);
}
