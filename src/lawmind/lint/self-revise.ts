import { appendProvenanceEvent, createProvenanceEvent, diffSummary } from "../drafts/provenance.js";
import type { ArtifactDraft } from "../types.js";
import { formatChineseInteger } from "./chinese-numeral.js";
import { findDepositPercents } from "./rules.js";
import { draftTextFromUnknown, runLegalLint } from "./run-lint.js";
import { DEPOSIT_CAP } from "./statute-params.js";
import type { LegalLintContext, LegalLintFinding, LegalLintReport } from "./types.js";

const SHORT_TEXT_LIMIT = 20;

/**
 * 法定参数类一律不自动改：超过法定上限是否调整、如何调整是交易结构判断
 * （如定金超过 20% 的法律后果是「超过部分不产生定金效力」，而非必须削到 20%），
 * 自动改违反「不替律师做法律判断」铁律——只产出建议式提案。
 */
const STATUTORY_PROPOSAL_RULE_IDS = new Set(["statutory.deposit_cap"]);

/** Forum choice, statutory caps and stance misses are never auto-decided. */
const SUBJECTIVE_RESIDUAL_RULE_IDS = new Set(["form.or_arbitrate_or_sue", "statutory.deposit_cap"]);

export type SelfReviseApplied = {
  ruleId: string;
  before: string;
  after: string;
};

/** 建议式提案：进入签批/提案通道，由律师定夺后才可落文。 */
export type SelfReviseProposal = {
  ruleId: string;
  /** 法条依据（如 民法典第586条）。 */
  statuteBasis?: string;
  before: string;
  after: string;
  requiresLawyerDecision: true;
};

export type SelfReviseResult = {
  rounds: number;
  applied: SelfReviseApplied[];
  proposals: SelfReviseProposal[];
  residual: LegalLintFinding[];
  residualMechanical: LegalLintFinding[];
  residualSubjective: LegalLintFinding[];
  text: string;
  summaryZh: string;
};

export function classifyResidual(findings: LegalLintFinding[]): {
  residualMechanical: LegalLintFinding[];
  residualSubjective: LegalLintFinding[];
} {
  const residualSubjective = findings.filter(
    (f) => SUBJECTIVE_RESIDUAL_RULE_IDS.has(f.ruleId) || f.ruleId.startsWith("stance."),
  );
  const residualMechanical = findings.filter(
    (f) => !SUBJECTIVE_RESIDUAL_RULE_IDS.has(f.ruleId) && !f.ruleId.startsWith("stance."),
  );
  return { residualMechanical, residualSubjective };
}

function shortNoop(text: string): SelfReviseResult {
  return {
    rounds: 0,
    applied: [],
    proposals: [],
    residual: [],
    residualMechanical: [],
    residualSubjective: [],
    text,
    summaryZh: "正文过短，未做自检。",
  };
}

function summarize(
  rounds: number,
  appliedCount: number,
  residualCount: number,
  proposalCount = 0,
): string {
  const parts = [`已做格式规范化 ${appliedCount} 处`];
  if (proposalCount > 0) {
    parts.push(`法定参数 ${proposalCount} 条建议（不代改原文）`);
  }
  parts.push(`${residualCount} 处需你定夺`);
  void rounds;
  return parts.join("；");
}

function finish(
  partial: Omit<SelfReviseResult, "residualMechanical" | "residualSubjective">,
): SelfReviseResult {
  const split = classifyResidual(partial.residual);
  return { ...partial, ...split };
}

/** 法定参数类建议式提案：只附建议 hunks 与法条依据，不改原文。 */
function buildStatutoryProposals(text: string, findings: LegalLintFinding[]): SelfReviseProposal[] {
  if (!findings.some((f) => STATUTORY_PROPOSAL_RULE_IDS.has(f.ruleId))) {
    return [];
  }
  const capPct = Math.round(DEPOSIT_CAP.value * 100);
  const proposals: SelfReviseProposal[] = [];
  for (const hit of findDepositPercents(text)) {
    if (hit.pct / 100 <= DEPOSIT_CAP.value) {
      continue;
    }
    let suggested = hit.span.replace(/(\d+(?:\.\d+)?)\s*%/, `${capPct}%`);
    if (suggested === hit.span) {
      suggested = hit.span.replace(
        /百分之[零一二两三四五六七八九十百]+(?:[点.][零一二两三四五六七八九]+)?/,
        `百分之${formatChineseInteger(capPct)}`,
      );
    }
    proposals.push({
      ruleId: "statutory.deposit_cap",
      statuteBasis: DEPOSIT_CAP.source,
      before: hit.span,
      after: suggested,
      requiresLawyerDecision: true,
    });
  }
  return proposals;
}

function normalizeFullwidthSpaces(text: string): { text: string; applied: SelfReviseApplied[] } {
  if (!/\u3000/.test(text)) {
    return { text, applied: [] };
  }
  return {
    text: text.replace(/\u3000/g, " "),
    applied: [{ ruleId: "normalize.fullwidth_space", before: "\u3000", after: " " }],
  };
}

/** Apply mechanical transforms without the short-text skip (used on section bodies). */
function applyMechanicalFixes(text: string): { text: string; applied: SelfReviseApplied[] } {
  return normalizeFullwidthSpaces(text ?? "");
}

/** Mutate draft summary/sections with mechanical fixes, then re-lint the concatenated text. */
export function applySelfReviseToDraft(draft: ArtifactDraft): SelfReviseResult {
  const applied: SelfReviseApplied[] = [];
  if (typeof draft.summary === "string") {
    const r = applyMechanicalFixes(draft.summary);
    draft.summary = r.text;
    applied.push(...r.applied);
  }
  for (const sec of draft.sections ?? []) {
    if (typeof sec.body !== "string") {
      continue;
    }
    const originalBody = sec.body;
    const r = applyMechanicalFixes(sec.body);
    sec.body = r.text;
    applied.push(...r.applied);
    if (sec.body !== originalBody && r.applied.length > 0) {
      const ruleIds = r.applied.map((a) => a.ruleId).join(", ");
      sec.provenance = appendProvenanceEvent(
        sec.provenance,
        createProvenanceEvent("self_revise", "system", {
          sourceId: draft.taskId,
          reason: ruleIds,
          diffSummary: diffSummary(originalBody, sec.body),
        }),
      );
    }
  }
  const preview = runSelfRevise(draftTextFromUnknown(draft), undefined, {
    deliverableType: draft.deliverableType,
  });
  if (applied.length === 0) {
    return preview;
  }
  return finish({
    rounds: Math.max(1, preview.rounds),
    applied: [...applied, ...preview.applied],
    proposals: preview.proposals,
    residual: preview.residual,
    text: preview.text,
    summaryZh: summarize(
      Math.max(1, preview.rounds),
      applied.length + preview.applied.length,
      preview.residual.length,
      preview.proposals.length,
    ),
  });
}

export function runSelfRevise(
  text: string,
  report?: LegalLintReport,
  context?: LegalLintContext,
): SelfReviseResult {
  const raw = text ?? "";
  if (raw.trim().length < SHORT_TEXT_LIMIT) {
    return shortNoop(raw);
  }

  const applied: SelfReviseApplied[] = [];
  const spaces = normalizeFullwidthSpaces(raw);
  const current = spaces.text;
  applied.push(...spaces.applied);

  const currentReport =
    report && spaces.applied.length === 0
      ? report
      : runLegalLint(current, undefined, undefined, [], context);
  const proposals = buildStatutoryProposals(current, currentReport.findings);
  const rounds = 1;

  return finish({
    rounds,
    applied,
    proposals,
    residual: currentReport.findings,
    text: current,
    summaryZh: summarize(rounds, applied.length, currentReport.findings.length, proposals.length),
  });
}

/** Cheap local preview for the review workbench — does not write disk. */
export function previewSelfRevise(text: string, context?: LegalLintContext): SelfReviseResult {
  return runSelfRevise(text, undefined, context);
}
