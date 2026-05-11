/**
 * 在既有「草稿审核通过」之后，将合同修订素材写入积累库（不增加单独前端流程）。
 */

import path from "node:path";
import { emit } from "../audit/index.js";
import { persistDraft } from "../drafts/index.js";
import type { ArtifactDraft } from "../types.js";
import { finalizeContractRevisionPack } from "./contract-revision-pack.js";

/**
 * 当 `draft.reviewStatus === "approved"` 且带 `contractRevisionCapture` 时，落盘积累包并回写草稿字段。
 * 失败不抛错：返回 `warning`，由 HTTP 层附加到响应；审核主流程已成功时不应再失败。
 */
export async function applyContractRevisionAccumulationAfterApprovedReview(
  workspaceDir: string,
  draft: ArtifactDraft,
  reviewNote?: string,
): Promise<{ draft: ArtifactDraft; revisionId?: string; warning?: string }> {
  if (draft.reviewStatus !== "approved") {
    return { draft };
  }
  if (draft.contractRevisionAccumulatedId) {
    return { draft };
  }
  const cap = draft.contractRevisionCapture;
  if (!cap) {
    return { draft };
  }
  const initialPath = cap.initialRelativePath?.trim() ?? "";
  const revisedPath = cap.revisedRelativePath?.trim() ?? "";
  if (!initialPath || !revisedPath) {
    return { draft, warning: "contract_revision_capture_missing_paths" };
  }
  const note = reviewNote?.trim() ?? "";
  const keys = (cap.keyModifications ?? []).map((x) => String(x).trim()).filter(Boolean);
  const auditDir = path.join(workspaceDir, "audit");
  try {
    const result = await finalizeContractRevisionPack({
      workspaceDir,
      initialSourcePath: initialPath,
      finalSourcePath: revisedPath,
      keyModifications:
        keys.length > 0 ? keys : note ? [note] : ["（审核通过，由交付草稿转入积累库）"],
      title: draft.title,
      requirementsSummary: note,
      matterId: draft.matterId,
      stableDocumentKey: cap.stableDocumentKey?.trim() || undefined,
      appendLawyerProfileBullet: false,
    });
    const next: ArtifactDraft = { ...draft, contractRevisionAccumulatedId: result.revisionId };
    delete next.contractRevisionCapture;
    persistDraft(workspaceDir, next);
    return { draft: next, revisionId: result.revisionId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit(auditDir, {
      taskId: draft.taskId,
      kind: "contract_revision_accumulation_failed",
      actor: "system",
      detail: msg.slice(0, 2000),
    });
    return { draft, warning: msg };
  }
}
