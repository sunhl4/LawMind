#!/usr/bin/env node
/**
 * Coverage ratchet: fail CI when global coverage drops below committed floors.
 * Run after `pnpm test:coverage` (expects coverage/coverage-summary.json).
 *
 *   node scripts/pre-commit/check-coverage-ratchet.mjs
 *   node scripts/pre-commit/check-coverage-ratchet.mjs --update
 *   node scripts/pre-commit/check-coverage-ratchet.mjs --allow-stale
 *
 * 两道防「绿但陈旧」：
 *   1. 输入新鲜度：覆盖率报告必须晚于被统计的源文件，否则数据不代表当前代码。
 *   2. 地板必须真的在地板上：地板长期远低于实际时，棘轮形同虚设
 *      （曾出现实际 62.77% / 地板 48%，等于容许 14 点无声下滑）。用 --update 收紧。
 *
 * tolerancePct 同时吸收测量抖动与跨环境差异（地板常在本机测、CI 跑 ubuntu），
 * 避免首次 CI 因平台差异误红。
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

/**
 * 覆盖率报告必须来自**当前**源码：报告比任何被统计的源文件旧，说明数据已失真。
 * 与 make/构建系统的 mtime 语义一致，也对齐「不让检查在陈旧输入上通过」的通行做法。
 * CI 里 checkout 后源码 mtime 统一、覆盖率随后生成，因此不会误报。
 */
const SOURCE_ROOTS = [
  "src/lawmind",
  "apps/lawmind-desktop/server",
  "apps/lawmind-desktop/src/renderer",
];
const SOURCE_EXT = new Set([".ts", ".tsx"]);
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "release", "coverage"]);

function newestSourceFile() {
  let newest = null;
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(entry.name)) {
          visit(path.join(dir, entry.name));
        }
        continue;
      }
      if (!SOURCE_EXT.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      const full = path.join(dir, entry.name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!newest || stat.mtimeMs > newest.mtimeMs) {
        newest = { path: full, mtimeMs: stat.mtimeMs };
      }
    }
  };
  for (const rel of SOURCE_ROOTS) {
    visit(path.join(REPO_ROOT, rel));
  }
  return newest;
}

/** 陈旧输入时给出可执行的修复路径，而不是只报一个数字。 */
function checkSummaryFreshness() {
  const summaryMtime = fs.statSync(SUMMARY_PATH).mtimeMs;
  const newest = newestSourceFile();
  if (!newest || newest.mtimeMs <= summaryMtime) {
    return null;
  }
  return {
    source: path.relative(REPO_ROOT, newest.path),
    sourceAge: newest.mtimeMs,
    summaryAge: summaryMtime,
  };
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
const allowStale = process.argv.includes("--allow-stale");
const { tolerancePct, floors } = loadBaseline();

if (!update && !allowStale) {
  const stale = checkSummaryFreshness();
  if (stale) {
    process.stderr.write(
      `[coverage-ratchet] 覆盖率报告已陈旧：${path.relative(REPO_ROOT, SUMMARY_PATH)} 早于源文件 ${stale.source}。\n` +
        "  陈旧数据上的通过等于没查（可能掩盖真实掉幅）。请先跑 pnpm test:coverage 重新生成。\n" +
        "  确需在陈旧数据上比对时加 --allow-stale（或 LAWMIND_ALLOW_STALE_COVERAGE=1）。\n",
    );
    process.exit(1);
  }
}

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
