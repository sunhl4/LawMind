/**
 * Repeatable external legal-skill census: queries, cutoff, hubs, license absorb, dedup.
 * Incremental re-check = same queries with created:>cutoff, minus catalog-known slugs.
 */

export const CENSUS_CUTOFF_ISO = "2026-09-07";

export const CENSUS_CATALOG_REL = "docs/LAWMIND-EXTERNAL-LEGAL-CAPABILITY-CATALOG.md";

export type CensusQueryAxis = "carrier" | "zh-task" | "en-task" | "datasource";

export type CensusQuery = {
  id: string;
  axis: CensusQueryAxis;
  /** GitHub search string (code or repo search). */
  q: string;
};

export const CENSUS_QUERIES: readonly CensusQuery[] = [
  { id: "skill-md-legal", axis: "carrier", q: "filename:SKILL.md legal" },
  { id: "skill-md-contract", axis: "carrier", q: "filename:SKILL.md contract review" },
  { id: "claude-plugin-legal", axis: "carrier", q: "claude-for-legal in:name" },
  { id: "cursor-rules-legal", axis: "carrier", q: "filename:SKILL.md cursor legal" },
  { id: "codex-skill-legal", axis: "carrier", q: "codex skill legal" },
  { id: "mcp-server-legal", axis: "carrier", q: "mcp server legal" },
  { id: "zh-contract-review", axis: "zh-task", q: "filename:SKILL.md 合同审查" },
  { id: "zh-litigation", axis: "zh-task", q: "filename:SKILL.md 诉讼" },
  { id: "zh-criminal", axis: "zh-task", q: "filename:SKILL.md 刑事辩护" },
  { id: "zh-research", axis: "zh-task", q: "filename:SKILL.md 法律检索" },
  { id: "zh-cn-mcp", axis: "zh-task", q: "中国法 MCP" },
  { id: "en-litigation", axis: "en-task", q: "filename:SKILL.md litigation" },
  { id: "en-research", axis: "en-task", q: "filename:SKILL.md legal research" },
  { id: "en-lpm", axis: "en-task", q: "filename:SKILL.md legal operations" },
  { id: "en-diligence", axis: "en-task", q: "filename:SKILL.md due diligence" },
  { id: "ds-courtlistener", axis: "datasource", q: "CourtListener MCP" },
  { id: "ds-eurlex", axis: "datasource", q: "EUR-Lex MCP" },
  { id: "ds-pkulaw", axis: "datasource", q: "北大法宝 MCP" },
  { id: "ds-yuandian", axis: "datasource", q: "元典 MCP" },
];

/** Always re-stat these hubs; they are discovery indexes, not one-off hits. */
export const CENSUS_HUB_REPOS = [
  "ThomasMoreAI/legal-skills-open",
  "CSlawyer1985/legal-skillhub",
  "sboghossian/mini-claude-for-legal",
  "vivy-yi/Greater-China-Legal",
  "lawve-ai/awesome-legal-skills",
  "anthropics/claude-for-legal",
  "pa1nrui1/legal-skills",
  "cat-xierluo/legal-skills",
  "legalopsconsulting/lpm-skills",
] as const;

export type LicenseAbsorb = "absorb" | "structure_only" | "skip";

export function normalizeRepoSlug(raw: string): string | undefined {
  const trimmed = raw
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const m = /^(?:https?:\/\/github\.com\/)?([^/\s]+\/[^/\s]+)$/i.exec(trimmed);
  const slug = m?.[1]?.replace(/\/+$/, "");
  if (!slug || slug.split("/").length !== 2) {
    return undefined;
  }
  const [owner, name] = slug.split("/");
  if (!owner || !name || name === "search") {
    return undefined;
  }
  return `${owner}/${name}`;
}

export function extractGithubRepoSlugs(markdown: string): string[] {
  const found = new Set<string>();
  const re = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const slug = normalizeRepoSlug(m[1] ?? "");
    if (slug) {
      found.add(slug);
    }
  }
  return [...found].toSorted((a, b) => a.localeCompare(b));
}

export function dedupCensusSlugs(slugs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of slugs) {
    const slug = normalizeRepoSlug(raw);
    if (!slug) {
      continue;
    }
    const key = slug.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(slug);
  }
  return out;
}

export function classifyLicenseAbsorb(license: string | undefined | null): LicenseAbsorb {
  const t = (license ?? "").trim().toLowerCase();
  if (!t || t === "other" || t === "none" || t === "unlicense" || t === "nolicense") {
    return "structure_only";
  }
  if (t.includes("agpl") || t.includes("gpl")) {
    return "skip";
  }
  if (t.includes("cc-by-nc") || t.includes("cc by-nc") || t === "cc-by-nc-4.0") {
    return "structure_only";
  }
  if (t.includes("mit") || t.includes("apache") || t === "bsd-2-clause" || t === "bsd-3-clause") {
    return "absorb";
  }
  if (t.includes("cc-by") || t.includes("cc by-sa")) {
    return "structure_only";
  }
  return "structure_only";
}

export function incrementalQuery(q: string, cutoffIso = CENSUS_CUTOFF_ISO): string {
  return `${q} created:>${cutoffIso}`;
}

export function newSlugsSinceKnown(hits: readonly string[], known: readonly string[]): string[] {
  const knownKeys = new Set(dedupCensusSlugs(known).map((s) => s.toLowerCase()));
  return dedupCensusSlugs(hits).filter((s) => !knownKeys.has(s.toLowerCase()));
}

export function buildCensusPack(knownFromCatalog: readonly string[]): {
  cutoffIso: string;
  catalogRel: string;
  queries: readonly CensusQuery[];
  incrementalQueries: Array<{ id: string; q: string }>;
  hubs: readonly string[];
  knownCount: number;
  known: readonly string[];
} {
  return {
    cutoffIso: CENSUS_CUTOFF_ISO,
    catalogRel: CENSUS_CATALOG_REL,
    queries: CENSUS_QUERIES,
    incrementalQueries: CENSUS_QUERIES.map((q) => ({
      id: q.id,
      q: incrementalQuery(q.q),
    })),
    hubs: CENSUS_HUB_REPOS,
    knownCount: knownFromCatalog.length,
    known: knownFromCatalog,
  };
}
