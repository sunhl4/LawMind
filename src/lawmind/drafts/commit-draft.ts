/**
 * Single draft-file write. Provenance is part of the type so a pipeline
 * save cannot forget the research snapshot that export's citation gate reads.
 * Agent file saves stay file-only; they do not grow pipeline side effects.
 */

import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import type { ArtifactDraft } from "../types.js";
import { resolveDraftCitationIntegrity } from "./citation-resolve.js";
import { invalidateDraftListCache } from "./list-cache.js";
import { evaluateMechanicalVerdict } from "./mechanical-verdict.js";

/** Same path as `draftPath` in `drafts/index.ts`. Kept here to avoid an import cycle. */
function draftFile(workspaceDir: string, taskId: string): string {
  return path.join(workspaceDir, "drafts", `${taskId}.json`);
}

export type DraftFileProvenance = {
  channel: "file";
};

/** Literal `true` fields: a pipeline commit that omits them does not type-check. */
export type DraftPipelineProvenance = {
  channel: "pipeline";
  researchSnapshot: true;
  audit: true;
  reasoningGraph: "when-spec-requires";
};

export type DraftCommitProvenance = DraftFileProvenance | DraftPipelineProvenance;

export type DeliverableCompletion = "drafting" | "mechanical_green" | "review_passed" | "signed";

export type DeliverableCompletionRecord = {
  completion: DeliverableCompletion;
  reviewStatus: ArtifactDraft["reviewStatus"];
  channel: DraftCommitProvenance["channel"];
  mechanicalGreen: boolean;
  blocks: string[];
  at: string;
};

export function completionSidecarPath(workspaceDir: string, taskId: string): string {
  return path.join(workspaceDir, "drafts", `${taskId}.completion.json`);
}

export function deriveDeliverableCompletion(
  draft: ArtifactDraft,
  mechanicalGreen: boolean,
): DeliverableCompletion {
  if (draft.reviewStatus === "approved") {
    const by = draft.reviewedBy ?? "";
    if (by.length > 0 && !by.startsWith("system:")) {
      return "signed";
    }
    return "review_passed";
  }
  if (mechanicalGreen) {
    return "mechanical_green";
  }
  return "drafting";
}

export function commitDraft(
  workspaceDir: string,
  draft: ArtifactDraft,
  provenance: DraftCommitProvenance,
): string {
  if (provenance.channel === "pipeline") {
    const citation = resolveDraftCitationIntegrity(workspaceDir, draft);
    if (!citation.checked && citation.reason === "no_research_snapshot") {
      throw new Error(
        `commitDraft: pipeline provenance requires drafts/${draft.taskId}.research.json before the draft file is written`,
      );
    }
  }
  const citation = resolveDraftCitationIntegrity(workspaceDir, draft);
  const verdict = evaluateMechanicalVerdict({
    citation,
    acceptanceReady: null,
    redlinePending: null,
  });
  const record: DeliverableCompletionRecord = {
    completion: deriveDeliverableCompletion(draft, verdict.green),
    reviewStatus: draft.reviewStatus,
    channel: provenance.channel,
    mechanicalGreen: verdict.green,
    blocks: verdict.blocks,
    at: new Date().toISOString(),
  };
  const target = draftFile(workspaceDir, draft.taskId);
  writeJsonAtomic(target, draft);
  writeJsonAtomic(completionSidecarPath(workspaceDir, draft.taskId), record);
  try {
    writeJsonAtomic(path.join(path.dirname(target), `${draft.taskId}.review-head.json`), {
      taskId: draft.taskId,
      matterId: draft.matterId,
      title: draft.title,
      reviewStatus: draft.reviewStatus,
      createdAt: draft.createdAt,
      reviewedAt: draft.reviewedAt,
    });
  } catch {
    /* 待签批列表下次会从完整文稿补索引 */
  }
  invalidateDraftListCache(workspaceDir);
  return target;
}
