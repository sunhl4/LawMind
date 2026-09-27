/**
 * Write the tracked sibling for a draft, reusing the filename already stored
 * on the draft so a later 出稿 overwrites that Word instead of minting `_02`.
 */

import { renderDocxWithTrackedChanges } from "../artifacts/render-docx-tracked.js";
import { planTrackedWordDelivery } from "../artifacts/word-revision-delivery.js";
import { persistDraft, readDraft } from "./index.js";
import { readRedlineProposal, type RedlineHunk } from "./redline-proposal.js";

/** Preview export keeps accepted hunks only. The add-in commit still includes pending revisions. */
export function selectTrackedExportHunks(
  hunks: readonly RedlineHunk[],
  acceptedOnly: boolean,
): RedlineHunk[] {
  return hunks.filter((hunk) =>
    acceptedOnly ? hunk.status === "accepted" : hunk.status !== "rejected",
  );
}

export async function exportTrackedSiblingForTask(params: {
  workspaceDir: string;
  taskId: string;
  projectDir?: string;
  /** Chat preview: do not write hunks the lawyer has not accepted. */
  acceptedOnly?: boolean;
}): Promise<
  | { ok: true; outputPath: string; outputFileName: string; mode: string; degraded: boolean }
  | { ok: false; error: string; code?: string; status: 400 | 404 | 409 }
> {
  const draft = readDraft(params.workspaceDir, params.taskId);
  if (!draft) {
    return { ok: false, error: "draft_not_found", status: 404 };
  }
  const proposal = readRedlineProposal(params.workspaceDir, params.taskId);
  const proposals = selectTrackedExportHunks(proposal?.hunks ?? [], params.acceptedOnly === true);
  if (params.acceptedOnly === true && proposals.length === 0) {
    return {
      ok: false,
      error: "还没有接受的修改。预览里没决定的不会写进文件。",
      code: "nothing_accepted",
      status: 409,
    };
  }
  const planned = planTrackedWordDelivery({
    workspaceDir: params.workspaceDir,
    projectDir: params.projectDir,
    baselineRel: draft.contractEdit?.baselineRelativePath,
    baselineRoot: draft.contractEdit?.baselineRoot,
    matterId: draft.matterId,
    fallbackBasename: `${draft.title?.trim() || "合同"}.docx`,
    existingOutputAbs: draft.outputPath,
  });
  const preferContractReview =
    (draft.deliverableType ?? "").startsWith("contract.") || Boolean(draft.contractEdit);
  const result = await renderDocxWithTrackedChanges({
    draft,
    outputDir: planned.outDir,
    proposals,
    workspaceDir: params.workspaceDir,
    projectDir: params.projectDir,
    templateVariant: preferContractReview ? "contractReview" : undefined,
    includeProvenance: false,
    outputFileName: planned.outputFileName,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, code: result.code, status: 400 };
  }
  const stored = readDraft(params.workspaceDir, params.taskId);
  if (stored && stored.outputPath !== result.outputPath) {
    persistDraft(params.workspaceDir, { ...stored, outputPath: result.outputPath });
  }
  return {
    ok: true,
    outputPath: result.outputPath,
    outputFileName: planned.outputFileName,
    mode: result.mode,
    degraded: result.degraded === true,
  };
}
