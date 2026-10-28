import type { ArtifactDraft } from "../types.js";
import {
  verifyDraftCitationEvidence,
  verifyDraftCitationEvidenceAsync,
  type DraftCitationIntegrityView,
} from "./citation-integrity.js";
import { readResearchSnapshot } from "./research-snapshot.js";

export function resolveDraftCitationIntegrity(
  workspaceDir: string,
  draft: ArtifactDraft,
): DraftCitationIntegrityView {
  const bundle = readResearchSnapshot(workspaceDir, draft.taskId);
  if (!bundle) {
    return { checked: false, reason: "no_research_snapshot" };
  }
  const r = verifyDraftCitationEvidence({ rootDir: workspaceDir, draft, bundle });
  return { checked: true, ...r };
}

/**
 * 异步版：PDF 页码 / Excel 单元格锚会真正读取原文再核对。
 * 用于交付验收包等异步路径；同步调用方继续用上面的保守版本。
 */
export async function resolveDraftCitationIntegrityAsync(
  workspaceDir: string,
  draft: ArtifactDraft,
): Promise<DraftCitationIntegrityView> {
  const bundle = readResearchSnapshot(workspaceDir, draft.taskId);
  if (!bundle) {
    return { checked: false, reason: "no_research_snapshot" };
  }
  const r = await verifyDraftCitationEvidenceAsync({ rootDir: workspaceDir, draft, bundle });
  return { checked: true, ...r };
}
