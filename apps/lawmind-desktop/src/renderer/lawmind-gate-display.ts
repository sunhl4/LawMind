import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";
import type { GateDecision } from "../../../../src/lawmind/platform/contracts.ts";
import {
  formatGateDecisionLine,
  gateDecisionLabel,
  listBlockingGateDecisions,
} from "../../../../src/lawmind/platform/review-gates.ts";

export {
  formatGateDecisionLine,
  gateDecisionLabel,
  listBlockingGateDecisions,
} from "../../../../src/lawmind/platform/review-gates.ts";

export function gateDecisionBadgeClass(decision: GateDecision["decision"]): string {
  if (decision === "allow") {
    return "lm-badge lm-badge-done";
  }
  if (decision === "awaiting_confirmation") {
    return "lm-badge lm-badge-running";
  }
  return "lm-badge lm-badge-error";
}

export function firstBlockerDomId(
  gates: GateDecision[] | undefined | null,
  acceptance?: AcceptanceReport | null,
): string | null {
  const blocking = listBlockingGateDecisions(gates);
  const first = blocking[0];
  if (!first) {
    if (acceptance && !acceptance.ready && acceptance.deliverableType) {
      return "lm-review-acceptance-gate";
    }
    return null;
  }
  if (first.gate === "acceptance_gate" || first.gate === "reasoning_gate") {
    return "lm-review-acceptance-gate";
  }
  if (first.gate === "approval_gate" || first.gate === "clarification_gate") {
    return "lm-review-acceptance-gate";
  }
  return "lm-review-acceptance-gate";
}

export function scrollToFirstBlocker(
  gates: GateDecision[] | undefined | null,
  acceptance?: AcceptanceReport | null,
): void {
  const id = firstBlockerDomId(gates, acceptance);
  if (id) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

export function buildGateStatusSummary(gates: GateDecision[] | undefined | null): string | null {
  const blocking = listBlockingGateDecisions(gates);
  if (blocking.length === 0) {
    return null;
  }
  return blocking.map((g) => formatGateDecisionLine(g)).join(" · ");
}
