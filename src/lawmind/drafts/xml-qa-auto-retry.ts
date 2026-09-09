/**
 * Unlocked path only: if tracked XML has no w:ins/w:del, narrow plan once and re-apply.
 * Never runs on mail short path or Word tracked lock.
 */

import type { ArtifactDraft } from "../types.js";
import { applySurgicalTextEdits, type SurgicalTextEdit } from "./apply-surgical-edits.js";
import {
  buildXmlQaRetryHint,
  normalizeRedlinePlanItems,
  readRedlinePlan,
  writeRedlinePlan,
} from "./redline-plan.js";
import { readRedlineProposal } from "./redline-proposal.js";

export function shouldAutoRetryXmlQa(ctx: {
  wordRevisionTurn?: boolean;
  mailContractTurn?: boolean;
}): boolean {
  return ctx.wordRevisionTurn !== true && ctx.mailContractTurn !== true;
}

export type XmlQaAutoRetryResult = {
  attempted: boolean;
  appliedCount: number;
  edits: SurgicalTextEdit[];
  draft?: ArtifactDraft;
  reason?: string;
};

/**
 * Apply narrowed redline-plan edits onto the draft body once.
 * Caller re-generates redline proposal and re-exports.
 */
export function applyNarrowedPlanOnce(input: {
  workspaceDir: string;
  draft: ArtifactDraft;
}): XmlQaAutoRetryResult {
  const plan = readRedlinePlan(input.workspaceDir, input.draft.taskId);
  const hint = buildXmlQaRetryHint(plan);
  const proposal = readRedlineProposal(input.workspaceDir, input.draft.taskId);
  const baselineSections = proposal?.baselineSections?.length
    ? proposal.baselineSections
    : input.draft.sections;
  const baselineText = baselineSections.map((section) => section.body).join("\n");
  const candidates = (plan?.items ?? []).map((item) => {
    // If the first-pass exact find is absent from baseline, try the original pair first.
    // Only prefer a normalized narrow pair when it actually anchors in baseline text.
    const normalized = normalizeRedlinePlanItems([{ find: item.find, replace: item.replace }])
      .items[0];
    return normalized && baselineText.includes(normalized.find)
      ? { find: normalized.find, replace: normalized.replace }
      : { find: item.find, replace: item.replace };
  });
  if (candidates.length === 0 || hint.edits.length === 0) {
    return {
      attempted: false,
      appliedCount: 0,
      edits: [],
      reason: "no_narrowed_edits",
    };
  }
  // The current draft normally already contains the first-pass replacements, so
  // reapplying `find` to it cannot hit. Rebuild from the locked pre-edit baseline,
  // then apply the best baseline-anchored plan and regenerate hunks against it.
  const applied = applySurgicalTextEdits({
    sections: baselineSections,
    edits: candidates,
  });
  if (!applied.ok) {
    return {
      attempted: true,
      appliedCount: 0,
      edits: candidates,
      reason: applied.error,
    };
  }
  if (applied.applied.length === 0) {
    return {
      attempted: true,
      appliedCount: 0,
      edits: candidates,
      reason: "no_hits_after_narrow",
      draft: { ...input.draft, sections: applied.sections },
    };
  }
  const next: ArtifactDraft = { ...input.draft, sections: applied.sections };
  writeRedlinePlan(input.workspaceDir, {
    taskId: input.draft.taskId,
    items: applied.applied.map((row) => ({
      find: row.find,
      replace: row.replace,
      note: row.note,
      narrowed: true,
    })),
    skipped: applied.skipped,
    updatedAt: new Date().toISOString(),
  });
  return {
    attempted: true,
    appliedCount: applied.applied.length,
    edits: candidates,
    draft: next,
  };
}
