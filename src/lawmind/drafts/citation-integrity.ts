/**
 * Cross-check draft section citations against a ResearchBundle (provenance hygiene).
 * Empty citations on short sections are allowed; long sections without cites are warned
 * as unanchored when the bundle has sources (does not fail `ok`).
 */

import type { ArtifactDraft, ResearchBundle } from "../types.js";
import { checkEvidenceSupport } from "./evidence-support.js";

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
  /**
   * 2026-10-21：来源文件在引用之后被改过（需要 I/O，纯函数版本恒为空）。
   * 由 `evidence-support.verifyDraftCitationEvidence` 填充。
   */
  staleSources?: Array<{ sourceId: string; reasonZh: string }>;
  /**
   * 2026-10-21：引用了来源，但记录的原文在该文件里找不到（需要 I/O）。
   * 与 `missingSourceIds` 不同：来源还在，只是依据对不上。
   */
  unverifiableSources?: Array<{ sourceId: string; reasonZh: string }>;
  quoteMismatches?: Array<{ sourceId: string; reasonZh: string }>;
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
    const cites = (sec.citations ?? []).map((c) => c.trim()).filter(Boolean);
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

/**
 * 在纯检查之上补两道「需要读文件」的核对：
 *   1. 来源文件在引用之后被改过（`stale`）；
 *   2. 引用的原句在文件里找不到（`quoteMismatch`）。
 *
 * 不做语义判断（「这句是否支持该结论」由模型/律师负责）；只保证
 * 「依据还在、原文还在」。任一项不为空即不得当作已核对通过。
 */
export function verifyDraftCitationEvidence(input: {
  draft: ArtifactDraft;
  bundle: ResearchBundle;
  /** 工作区根：来源 `url` 按相对路径解析。 */
  rootDir: string;
  /** quote 由调用方从 claim / section 里取；缺省按 sourceId 到 bundle.claims 里找。 */
  quoteForSource?: (sourceId: string) => string | undefined;
}): CitationIntegrityResult {
  const base = validateDraftCitationsAgainstBundle(input.draft, input.bundle);
  const staleSources: Array<{ sourceId: string; reasonZh: string }> = [];
  const quoteMismatches: Array<{ sourceId: string; reasonZh: string }> = [];
  const unverifiableSources: Array<{ sourceId: string; reasonZh: string }> = [];

  const cited = new Set<string>();
  for (const section of input.draft.sections) {
    for (const id of section.citations ?? []) {
      const trimmed = id.trim();
      if (trimmed) {
        cited.add(trimmed);
      }
    }
  }

  for (const source of input.bundle.sources) {
    if (!cited.has(source.id)) {
      continue;
    }
    const relPath = (source.url ?? "").trim();
    if (/^https?:\/\//i.test(relPath)) {
      continue;
    }
    if (!relPath) {
      if (source.sourceVersion || source.kind === "workspace") {
        unverifiableSources.push({
          sourceId: source.id,
          reasonZh: "本地来源未记录路径，无法核对。",
        });
      }
      continue;
    }
    const claims = input.bundle.claims.filter((claim) => claim.sourceIds.includes(source.id));
    const override = input.quoteForSource?.(source.id);
    const quotes =
      override !== undefined
        ? [override]
        : claims.length > 0
          ? claims.map((claim) => claim.pin?.quote ?? "")
          : [source.excerpt ?? ""];
    for (const quote of new Set(quotes)) {
      const support = checkEvidenceSupport({
        rootDir: input.rootDir,
        relPath,
        quote,
        expectedVersion: source.sourceVersion,
      });
      const issue = { sourceId: source.id, reasonZh: support.reasonZh };
      if (support.status === "stale") {
        staleSources.push(issue);
      } else if (support.status === "quote_mismatch" || support.status === "missing") {
        quoteMismatches.push(issue);
      } else if (support.status === "unverifiable") {
        unverifiableSources.push(issue);
      }
    }
  }

  return {
    ...base,
    ok:
      base.ok &&
      staleSources.length === 0 &&
      quoteMismatches.length === 0 &&
      unverifiableSources.length === 0,
    ...(unverifiableSources.length > 0 ? { unverifiableSources } : {}),
    ...(staleSources.length > 0 ? { staleSources } : {}),
    ...(quoteMismatches.length > 0 ? { quoteMismatches } : {}),
  };
}
