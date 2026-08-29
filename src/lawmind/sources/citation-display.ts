/**
 * Lawyer-facing citation labels for research sources.
 * Prefer statute/case citation strings; never surface opaque source ids in primary UI.
 */

export type CitationDisplaySource = {
  id?: string;
  title?: string;
  kind?: string;
  citation?: string;
  court?: string;
  caseNumber?: string;
  date?: string;
  url?: string;
};

/** Heuristic: internal ids like src-1 / s-001 / uuid fragments should not be shown as cite text. */
export function looksLikeOpaqueSourceId(value: string | null | undefined): boolean {
  const t = value?.trim() ?? "";
  if (!t) {
    return true;
  }
  if (/^(src|source|s|ref|cite)[-_.:]?\d+$/i.test(t)) {
    return true;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return true;
  }
  if (/^[0-9a-f]{16,}$/i.test(t)) {
    return true;
  }
  if (/^[a-z]{1,4}[-_]\d{1,6}$/i.test(t) && t.length <= 12) {
    return true;
  }
  return false;
}

/**
 * Primary label for chips / 「参见」 lists — Chinese legal-report style.
 * Order: explicit citation → case number → court+title → title → soft fallback (never raw id).
 */
export function formatLawyerFacingCitation(
  source: CitationDisplaySource | null | undefined,
  opts?: { missingFallback?: string },
): string {
  const missing = opts?.missingFallback?.trim() || "引用待核实";
  if (!source) {
    return missing;
  }

  const citation = source.citation?.trim();
  if (citation && !looksLikeOpaqueSourceId(citation)) {
    return citation;
  }

  const caseNumber = source.caseNumber?.trim();
  if (caseNumber) {
    const court = source.court?.trim();
    return court ? `${court}${caseNumber}` : caseNumber;
  }

  const title = source.title?.trim();
  if (title && !looksLikeOpaqueSourceId(title)) {
    const court = source.court?.trim();
    if (court && (source.kind === "case" || source.kind === "court_view")) {
      return `${court}「${title}」`;
    }
    return title;
  }

  if (citation) {
    return citation;
  }

  return missing;
}

export function sourceKindLabelZh(kind: string | null | undefined): string {
  switch (kind) {
    case "statute":
      return "法律";
    case "regulation":
      return "法规 / 司法解释";
    case "case":
      return "裁判文书";
    case "court_view":
      return "司法观点";
    case "book":
      return "著作";
    case "memo":
      return "工作备忘";
    case "contract":
      return "合同";
    case "web":
      return "网络资料";
    case "workspace":
    case "internal":
      return "所内资料";
    default:
      return "资料";
  }
}

/** Footnote marker ①②…⑨⑩ then 11. */
export function citationFootnoteMarker(index: number): string {
  const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  if (index >= 0 && index < circled.length) {
    return circled[index];
  }
  return String(index + 1);
}

/**
 * Section-end line for Word / PPT / UI: 「参见：①《法》第×条；②（2020）…号。」
 * Falls back to 「引用待核实」 when a source id cannot be resolved — never dumps raw ids.
 */
export function formatSectionSeeAlsoLine(
  sourceIds: string[] | null | undefined,
  sources?: Iterable<CitationDisplaySource> | null,
): string | null {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of sourceIds ?? []) {
    const id = raw?.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) {
    return null;
  }

  const byId = new Map<string, CitationDisplaySource>();
  for (const s of sources ?? []) {
    const id = s.id?.trim();
    if (id) {
      byId.set(id, s);
    }
  }

  const parts = ids.map((id, index) => {
    const label = formatLawyerFacingCitation(byId.get(id), { missingFallback: "引用待核实" });
    return `${citationFootnoteMarker(index)}${label}`;
  });
  return `参见：${parts.join("；")}。`;
}
