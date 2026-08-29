#!/usr/bin/env node
/**
 * Coverage ratchet: fail CI when global coverage drops below committed floors.
 * Run after `pnpm test:coverage` (expects coverage/coverage-summary.json).
 *
 *   node scripts/pre-commit/check-coverage-ratchet.mjs
 *   node scripts/pre-commit/check-coverage-ratchet.mjs --update
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASELINE_PATH = path.join(import.meta.dirname, "coverage-baseline.json");
const SUMMARY_PATH = path.join(REPO_ROOT, "coverage", "coverage-summary.json");

const METRICS = ["statements", "branches", "functions", "lines"];

function loadBaseline() {
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  const tolerancePct = typeof raw.tolerancePct === "number" ? raw.tolerancePct : 0.5;
  const floors = raw.floors ?? {};
  for (const key of METRICS) {
    if (typeof floors[key] !== "number") {
      throw new Error(`coverage-baseline.json missing floors.${key}`);
    }
  }
  return { tolerancePct, floors };
}

function loadSummary() {
  if (!fs.existsSync(SUMMARY_PATH)) {
    throw new Error(
      `Missing ${path.relative(REPO_ROOT, SUMMARY_PATH)} — run pnpm test:coverage first`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8"));
  const total = raw.total;
  if (!total) {
    throw new Error("coverage-summary.json has no total section");
  }
  const current = {};
  for (const key of METRICS) {
    const pct = total[key]?.pct;
    if (typeof pct !== "number") {
      throw new Error(`coverage-summary.json missing total.${key}.pct`);
    }
    current[key] = pct;
  }
  return current;
}

function writeBaseline(floors, tolerancePct) {
  const payload = {
    description:
      "Coverage ratchet floors (see scripts/pre-commit/check-coverage-ratchet.mjs). Update with --update after intentional coverage gains.",
    tolerancePct,
    floors,
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const update = process.argv.includes("--update");
const { tolerancePct, floors } = loadBaseline();
const current = loadSummary();

if (update) {
  writeBaseline(current, tolerancePct);
  process.stderr.write(
    `[coverage-ratchet] Updated ${path.relative(REPO_ROOT, BASELINE_PATH)} from current run.\n`,
  );
  for (const key of METRICS) {
    process.stderr.write(`  ${key}: ${current[key].toFixed(2)}%\n`);
  }
  process.exit(0);
}

let failCount = 0;
for (const key of METRICS) {
  const floor = floors[key];
  const minAllowed = floor - tolerancePct;
  const value = current[key];
  if (value + 1e-9 < minAllowed) {
    process.stderr.write(
      `[coverage-ratchet] ${key}: ${value.toFixed(2)}% < floor ${floor.toFixed(2)}% (tolerance ${tolerancePct}%)\n`,
    );
    failCount += 1;
  } else {
    process.stderr.write(
      `[coverage-ratchet] ${key}: ${value.toFixed(2)}% (floor ${floor.toFixed(2)}%)\n`,
    );
  }
}

if (failCount > 0) {
  process.stderr.write(
    `[coverage-ratchet] ${failCount} metric(s) below ratchet — add tests or run with --update after review.\n`,
  );
  process.exit(1);
}

process.exit(0);
