/**
 * Unlocked 成套审查：keep the opinion, then swap draft sections to the pinned
 * Word body so apply_surgical_edits / redline hunks target the contract.
 * Never used on mail short path or file-page Word revision (wordRevisionTurn).
 */

import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import type { ArtifactDraft } from "../types.js";
import {
  draftLooksLikeContractOpinion,
  enrichDraftWithContractEditBaseline,
} from "./contract-edit-baseline.js";

const OPINION_HEADING_RE = /^(审查结论|宏观审查|中观审查|微观条款|修改建议)$/;

export function draftHasOpinionScaffoldHeadings(draft: ArtifactDraft): boolean {
  return (draft.sections ?? []).some((s) => OPINION_HEADING_RE.test((s.heading ?? "").trim()));
}

export function shouldPreparePairedRedlineBody(params: {
  draft: ArtifactDraft;
  wordRevisionTurn?: boolean;
}): boolean {
  if (params.wordRevisionTurn) {
    return false;
  }
  if ((params.draft.pairedOpinionSections?.length ?? 0) > 0) {
    return false;
  }
  if (!params.draft.contractEdit?.baselineRelativePath?.trim()) {
    return false;
  }
  if (
    !draftLooksLikeContractOpinion(params.draft) &&
    !draftHasOpinionScaffoldHeadings(params.draft)
  ) {
    return false;
  }
  return draftHasOpinionScaffoldHeadings(params.draft);
}

export async function preparePairedRedlineBody(params: {
  workspaceDir: string;
  projectDir?: string;
  draft: ArtifactDraft;
  wordRevisionTurn?: boolean;
  pins?: ComposeContextPin[];
}): Promise<{ draft: ArtifactDraft; swapped: boolean; warning?: string }> {
  if (!shouldPreparePairedRedlineBody(params)) {
    return { draft: params.draft, swapped: false };
  }
  const snapshot = params.draft.sections.map((s) => ({ ...s }));
  const { draft: seeded, warnings } = await enrichDraftWithContractEditBaseline({
    workspaceDir: params.workspaceDir,
    projectDir: params.projectDir,
    draft: params.draft,
    seedSections: true,
    pins: params.pins,
  });
  if (draftHasOpinionScaffoldHeadings(seeded)) {
    return {
      draft: params.draft,
      swapped: false,
      warning: warnings[0] ?? "成套审查未能读入合同基线正文，意见稿未替换。",
    };
  }
  return {
    draft: { ...seeded, pairedOpinionSections: snapshot },
    swapped: true,
    warning: warnings[0],
  };
}
