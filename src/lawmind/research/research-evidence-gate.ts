/**
 * Evidence readiness gate for outline-gated research deliverables.
 * Hard-block only when there are no usable claims or evidence is demo-only.
 * Soft riskFlags (web-off, partial filter, degraded JSON) only drive recovery CTAs.
 */

import { isOutlineGatedDeliverable } from "../reasoning/research-draft-gates.js";
import { isDemoCorpusResult } from "../retrieval/authority-gap.js";
import type { DeliverableType, ResearchBundle } from "../types.js";

export type ResearchEvidenceNextAction =
  | "open_settings_models"
  | "open_settings_doctor"
  | "enable_web_search"
  | "restart_research";

export type ResearchEvidenceGateResult = {
  block: boolean;
  reason?: string;
  nextStep: string;
  nextActions: ResearchEvidenceNextAction[];
  gateDecision?: {
    gate: "research_evidence_gate";
    decision: "block" | "allow";
    reason: string;
  };
};

/** Soft signals that suggest opening settings — never alone decide block. */
const SOFT_SETUP_HINT_RE =
  /(HTTP\s*401|\b401\b|allowWebSearch 未开启|联网.*关闭|模型未返回|检索失败)/i;

export function hasSoftSetupHintFlags(riskFlags: string[] | undefined): boolean {
  if (!riskFlags?.length) {
    return false;
  }
  return riskFlags.some((f) => SOFT_SETUP_HINT_RE.test(f));
}

/** @deprecated Use hasSoftSetupHintFlags — kept for callers that only need CTA hints. */
export function hasRetrievalFailureRiskFlags(riskFlags: string[] | undefined): boolean {
  return hasSoftSetupHintFlags(riskFlags);
}

function buildNextActions(opts: {
  webOff: boolean;
  softHints: boolean;
  block: boolean;
}): ResearchEvidenceNextAction[] {
  const actions: ResearchEvidenceNextAction[] = [];
  if (opts.webOff || opts.softHints || opts.block) {
    actions.push("enable_web_search", "open_settings_models", "open_settings_doctor");
  }
  if (opts.block) {
    actions.push("restart_research");
  }
  return [...new Set(actions)];
}

export function evaluateResearchEvidenceGate(opts: {
  deliverableType?: DeliverableType;
  bundle: ResearchBundle | null | undefined;
  allowWebSearch?: boolean;
  /** When false, skip gate (non-outline-gated). Default: auto from deliverableType. */
  forceApply?: boolean;
}): ResearchEvidenceGateResult {
  const apply = opts.forceApply === true || isOutlineGatedDeliverable(opts.deliverableType);
  if (!apply) {
    return {
      block: false,
      nextStep: "",
      nextActions: [],
      gateDecision: {
        gate: "research_evidence_gate",
        decision: "allow",
        reason: "not outline-gated",
      },
    };
  }

  const bundle = opts.bundle;
  const noClaims = !bundle || bundle.claims.length === 0;
  const demo = bundle ? isDemoCorpusResult(bundle) : false;
  const softHints = hasSoftSetupHintFlags(bundle?.riskFlags);
  const webOff = opts.allowWebSearch !== true;
  const block = noClaims || demo;

  if (!block) {
    const nextActions = buildNextActions({ webOff, softHints, block: false });
    return {
      block: false,
      nextStep: "",
      nextActions,
      gateDecision: {
        gate: "research_evidence_gate",
        decision: "allow",
        reason: "evidence ready",
      },
    };
  }

  const reasons: string[] = [];
  if (noClaims) {
    reasons.push("无可用检索结论（claims 为空）");
  }
  if (demo) {
    reasons.push("仅命中演示语料，不能作为权威依据扩写正文");
  }
  const reason = reasons.join("；");
  return {
    block: true,
    reason,
    nextStep: `${reason}。请先在设置中配置模型/开联网并重跑 deep_research，勿用 write_document 旁路交付。`,
    nextActions: buildNextActions({ webOff, softHints: true, block: true }),
    gateDecision: {
      gate: "research_evidence_gate",
      decision: "block",
      reason,
    },
  };
}

export const RESEARCH_EVIDENCE_GATE_REFUSAL =
  "研究类交付证据不足：已拒绝扩写正文。请配置模型/开启联网后重跑 deep_research，或补充权威 URL 后再起草。勿用 write_document 旁路。";
