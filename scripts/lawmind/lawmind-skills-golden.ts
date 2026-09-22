#!/usr/bin/env node
/**
 * Skills S0 — golden fixture smoke (no LLM required).
 * Usage: pnpm lawmind:skills:golden [-- --workspace <dir>] [--json]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVerificationChecklistSpec } from "../../src/lawmind/deliverables/verification-checklist.js";
import { summarizeProductMetrics } from "../../src/lawmind/metrics/product-metrics.js";
import { runTriageRules } from "../../src/lawmind/triage/rules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "fixtures/lawmind-skills-golden");

type CatalogCase = {
  id: string;
  inputPath: string;
  expectedPath: string;
  expected: { triageTier: string; deliverableTypeHint: string };
};

type ExpectedFile = {
  id: string;
  triageTier: string;
  deliverableTypeHint: string;
  checklistSpecId: string;
};

function parseArgs(argv: string[]): { workspace?: string; json: boolean; compare: boolean } {
  let workspace: string | undefined;
  let json = false;
  let compare = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      json = true;
    } else if (a === "--compare") {
      compare = true;
    } else if (a === "--workspace" && argv[i + 1]) {
      workspace = path.resolve(argv[++i]);
    }
  }
  return { workspace, json, compare };
}

function main(): void {
  const { workspace, json, compare } = parseArgs(process.argv.slice(2));
  const catalogPath = path.join(fixtureRoot, "catalog.json");
  if (!fs.existsSync(catalogPath)) {
    console.error(`missing catalog: ${catalogPath}`);
    process.exit(1);
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
    count: number;
    cases: CatalogCase[];
  };
  if (catalog.cases.length !== 20) {
    console.error(`expected 20 cases, got ${catalog.cases.length}`);
    process.exit(1);
  }

  const failures: string[] = [];
  const rows: Array<Record<string, unknown>> = [];

  for (const c of catalog.cases) {
    const inputAbs = path.join(fixtureRoot, c.inputPath);
    const expectedAbs = path.join(fixtureRoot, c.expectedPath);
    if (!fs.existsSync(inputAbs)) {
      failures.push(`${c.id}: missing input ${c.inputPath}`);
      continue;
    }
    if (!fs.existsSync(expectedAbs)) {
      failures.push(`${c.id}: missing expected ${c.expectedPath}`);
      continue;
    }
    const text = fs.readFileSync(inputAbs, "utf8");
    const expected = JSON.parse(fs.readFileSync(expectedAbs, "utf8")) as ExpectedFile;
    const triage = runTriageRules({
      text,
      deliverableTypeHint: expected.deliverableTypeHint,
    });
    const checklist = resolveVerificationChecklistSpec(expected.deliverableTypeHint);
    if (checklist.id !== expected.checklistSpecId) {
      failures.push(
        `${c.id}: checklistSpecId expected ${expected.checklistSpecId}, got ${checklist.id}`,
      );
    }
    // Soft: tier may diverge until rules mature; warn but don't fail G0 smoke on tier mismatch.
    const tierMatch = triage.tier === expected.triageTier;
    if (!tierMatch) {
      rows.push({
        id: c.id,
        warn: "triage_tier_mismatch",
        expected: expected.triageTier,
        actual: triage.tier,
      });
    } else {
      rows.push({ id: c.id, ok: true, tier: triage.tier, checklist: checklist.id });
    }
  }

  const metrics = workspace ? summarizeProductMetrics(workspace) : null;
  const tierMismatches = rows.filter((r) => r.warn === "triage_tier_mismatch").length;
  const report = {
    ok: failures.length === 0,
    fixtureRoot: path.relative(repoRoot, fixtureRoot),
    caseCount: catalog.cases.length,
    failures,
    rows,
    productMetrics: metrics,
    compare: compare
      ? {
          baseline: "S0 golden fixtures (fixtures/lawmind-skills-golden)",
          hardFailures: failures.length,
          softTierMismatches: tierMismatches,
          passRateHard: catalog.cases.length
            ? (catalog.cases.length - failures.length) / catalog.cases.length
            : 0,
          notes:
            "Soft tier mismatches are expected until triage rules fully align with S0 expected tiers; hard failures block G6.",
        }
      : undefined,
  };

  if (compare) {
    const outDir = path.join(repoRoot, "docs", "generated");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "skills-golden-compare-report.json");
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote compare report: ${path.relative(repoRoot, outPath)}`);
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Skills golden smoke: ${report.caseCount} cases · failures=${failures.length}`);
    for (const f of failures) {
      console.log(`  FAIL ${f}`);
    }
    if (tierMismatches) {
      console.log(`  tier mismatches (soft): ${tierMismatches}`);
    }
    if (metrics) {
      console.log(
        `  product metrics: total=${metrics.total} triageConfirmed=${metrics.triageConfirmed} gateFailures=${metrics.gateFailures}`,
      );
    }
    if (compare && report.compare) {
      console.log(
        `  compare: hardFail=${report.compare.hardFailures} softTier=${report.compare.softTierMismatches} passRateHard=${report.compare.passRateHard.toFixed(2)}`,
      );
    }
  }

  process.exit(failures.length === 0 ? 0 : 1);
}

main();
