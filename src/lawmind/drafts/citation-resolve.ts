import type { ArtifactDraft } from "../types.js";
import {
  validateDraftCitationsAgainstBundle,
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
  const r = validateDraftCitationsAgainstBundle(draft, bundle);
  return { checked: true, ...r };
}
