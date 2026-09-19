import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CENSUS_CATALOG_REL,
  CENSUS_CUTOFF_ISO,
  CENSUS_HUB_REPOS,
  CENSUS_QUERIES,
  CENSUS_DIGEST_RECORD_REL,
  CENSUS_DIGEST_RECORD_SECTION,
  buildCensusPack,
  classifyLicenseAbsorb,
  dedupCensusSlugs,
  extractGithubRepoSlugs,
  incrementalQuery,
  newSlugsSinceKnown,
  normalizeRepoSlug,
} from "./external-skill-census.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("external-skill-census", () => {
  it("covers carrier, zh, en and datasource axes with a dated cutoff", () => {
    const axes = new Set(CENSUS_QUERIES.map((q) => q.axis));
    expect(axes).toEqual(new Set(["carrier", "zh-task", "en-task", "datasource"]));
    expect(CENSUS_QUERIES.length).toBeGreaterThanOrEqual(12);
    expect(CENSUS_CUTOFF_ISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(incrementalQuery("filename:SKILL.md legal")).toContain(`created:>${CENSUS_CUTOFF_ISO}`);
  });

  it("keeps hub repos inside the catalog snapshot and dedups forks/case", () => {
    const catalog = fs.readFileSync(path.join(repoRoot, CENSUS_CATALOG_REL), "utf8");
    expect(catalog).toContain(`截止时间：${CENSUS_CUTOFF_ISO}`);
    const known = extractGithubRepoSlugs(catalog);
    expect(known.length).toBeGreaterThanOrEqual(40);
    for (const hub of CENSUS_HUB_REPOS) {
      expect(known.map((s) => s.toLowerCase())).toContain(hub.toLowerCase());
    }
    expect(
      dedupCensusSlugs(["ThomasMoreAI/legal-skills-open", "thomasmoreai/legal-skills-open.git"]),
    ).toEqual(["ThomasMoreAI/legal-skills-open"]);
    expect(normalizeRepoSlug("https://github.com/pa1nrui1/legal-skills")).toBe(
      "pa1nrui1/legal-skills",
    );
  });

  it("classifies absorb vs structure-only vs skip without vendoring NC/GPL", () => {
    expect(classifyLicenseAbsorb("MIT")).toBe("absorb");
    expect(classifyLicenseAbsorb("Apache-2.0")).toBe("absorb");
    expect(classifyLicenseAbsorb("CC-BY-NC-4.0")).toBe("structure_only");
    expect(classifyLicenseAbsorb("AGPL-3.0")).toBe("skip");
    expect(classifyLicenseAbsorb("GPL-3.0")).toBe("skip");
    expect(classifyLicenseAbsorb(undefined)).toBe("structure_only");
  });

  it("reports only repos not already in the catalog snapshot", () => {
    const catalog = fs.readFileSync(path.join(repoRoot, CENSUS_CATALOG_REL), "utf8");
    const known = extractGithubRepoSlugs(catalog);
    const pack = buildCensusPack(known);
    expect(pack.knownCount).toBe(known.length);
    expect(
      newSlugsSinceKnown(["pa1nrui1/legal-skills", "example-org/new-legal-skill"], known),
    ).toEqual(["example-org/new-legal-skill"]);
  });

  it("points incremental findings at the digest record section that actually exists", () => {
    const pack = buildCensusPack([]);
    expect(pack.digestRecordRel).toBe(CENSUS_DIGEST_RECORD_REL);
    expect(pack.digestRecordHint).toContain("待消化");
    // 指向的章节必须真的在文件里（否则增量无处登记）。
    const doc = fs.readFileSync(path.join(repoRoot, pack.digestRecordRel), "utf8");
    expect(doc).toContain(CENSUS_DIGEST_RECORD_SECTION);
    expect(doc).toContain("### 待消化（下一期候选）");
    expect(doc).toContain("| 日期 | builtin skill |");
  });
});
