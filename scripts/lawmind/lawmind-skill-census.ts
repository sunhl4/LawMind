#!/usr/bin/env node
/**
 * Repeatable legal-skill census (`pnpm lawmind:skill-census`).
 * Default: print query pack + catalog-known slugs (offline).
 * `--fetch`: run GitHub code search for incremental queries (needs `gh`).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CENSUS_CATALOG_REL,
  CENSUS_QUERIES,
  buildCensusPack,
  extractGithubRepoSlugs,
  incrementalQuery,
  newSlugsSinceKnown,
  normalizeRepoSlug,
} from "../../src/lawmind/skills/census/external-skill-census.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function catalogMarkdown(): string {
  return fs.readFileSync(path.join(repoRoot, CENSUS_CATALOG_REL), "utf8");
}

function fetchIncrementalSlugs(limitPerQuery = 15): string[] {
  const gh = spawnSync("gh", ["--version"], { encoding: "utf8" });
  if (gh.status !== 0) {
    console.error("gh 不可用，跳过 --fetch。离线包已打印。");
    return [];
  }
  const found: string[] = [];
  for (const query of CENSUS_QUERIES) {
    const q = incrementalQuery(query.q);
    const run = spawnSync(
      "gh",
      ["search", "code", q, "--limit", String(limitPerQuery), "--json", "repository"],
      { encoding: "utf8" },
    );
    if (run.status !== 0) {
      continue;
    }
    try {
      const rows = JSON.parse(run.stdout) as Array<{ repository?: { nameWithOwner?: string } }>;
      for (const row of rows) {
        const slug = normalizeRepoSlug(row.repository?.nameWithOwner ?? "");
        if (slug) {
          found.push(slug);
        }
      }
    } catch {
      /* skip malformed */
    }
  }
  return found;
}

function main(): void {
  const fetch = process.argv.includes("--fetch");
  const known = extractGithubRepoSlugs(catalogMarkdown());
  const pack = buildCensusPack(known);
  if (!fetch) {
    process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
    return;
  }
  const hits = fetchIncrementalSlugs();
  const fresh = newSlugsSinceKnown(hits, known);
  process.stdout.write(
    `${JSON.stringify({ ...pack, fetchHits: hits.length, newSinceCutoff: fresh }, null, 2)}\n`,
  );
}

main();
