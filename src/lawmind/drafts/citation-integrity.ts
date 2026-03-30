/**
 * Cross-check draft section citations against a ResearchBundle (provenance hygiene).
 * Empty or missing `citations` on a section is allowed (not every section must cite).
 */

import type { ArtifactDraft, ResearchBundle } from "../types.js";

export type CitationIntegrityResult = {
  ok: boolean;
  /** Source IDs referenced by the draft but absent from bundle.sources */
  missingSourceIds: string[];
  /** Per-section breakdown when there are gaps */
  sectionsWithIssues: Array<{ heading: string; missing: string[] }>;
};

/** API / UI: either we have a stored research snapshot, or citation check is skipped */
export type DraftCitationIntegrityView =
  | { checked: false; reason: "no_research_snapshot" }
  | ({ checked: true } & CitationIntegrityResult);

export function validateDraftCitationsAgainstBundle(
  draft: ArtifactDraft,
  bundle: ResearchBundle,
): CitationIntegrityResult {
  const sourceIds = new Set(bundle.sources.map((s) => s.id));
  const missingGlobal = new Set<string>();
  const sectionsWithIssues: Array<{ heading: string; missing: string[] }> = [];

  for (const sec of draft.sections) {
    const cites = (sec.citations ?? []).map((c) => String(c).trim()).filter(Boolean);
    if (cites.length === 0) {
      continue;
    }
    const missing = cites.filter((id) => !sourceIds.has(id));
    if (missing.length > 0) {
      for (const m of missing) {
        missingGlobal.add(m);
      }
      sectionsWithIssues.push({ heading: sec.heading, missing });
    }
  }

  return {
    ok: missingGlobal.size === 0,
    missingSourceIds: [...missingGlobal].toSorted(),
    sectionsWithIssues,
  };
}
