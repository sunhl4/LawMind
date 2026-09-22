/**
 * Cross-check draft section citations against a ResearchBundle (provenance hygiene).
 * Empty citations on short sections are allowed; long sections without cites are warned
 * as unanchored when the bundle has sources (does not fail `ok`).
 */

import type { ArtifactDraft, ResearchBundle } from "../types.js";

const UNANCHORED_BODY_MIN_LENGTH = 80;

export type CitationIntegrityResult = {
  ok: boolean;
  /** Source IDs referenced by the draft but absent from bundle.sources */
  missingSourceIds: string[];
  /** Per-section breakdown when there are gaps */
  sectionsWithIssues: Array<{ heading: string; missing: string[] }>;
  /**
   * Sections with substantial body text but no citations, when the research
   * bundle has sources. Warning only — does not affect `ok`.
   */
  unanchoredSections: Array<{ heading: string; reason: string }>;
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
  const unanchoredSections: Array<{ heading: string; reason: string }> = [];
  const hasSources = bundle.sources.length > 0;

  for (const sec of draft.sections) {
    const cites = (sec.citations ?? []).map((c) => String(c).trim()).filter(Boolean);
    if (cites.length === 0) {
      if (hasSources && (sec.body ?? "").trim().length > UNANCHORED_BODY_MIN_LENGTH) {
        unanchoredSections.push({
          heading: sec.heading,
          reason: "section_lacks_citations",
        });
      }
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
    unanchoredSections,
  };
}
