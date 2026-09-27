#!/usr/bin/env node
/**
 * Coverage ratchet: fail CI when global coverage drops below committed floors,
 * or when a floor sits so far under the measurement that a later drop could
 * land green. Run after `pnpm test:coverage` (expects coverage/coverage-summary.json).
 *
 *   node scripts/pre-commit/check-coverage-ratchet.mjs
 *   node scripts/pre-commit/check-coverage-ratchet.mjs --update
 *   node scripts/pre-commit/check-coverage-ratchet.mjs --allow-stale
 *
 * 两道防「绿但陈旧」：
 *   1. 输入新鲜度：覆盖率报告必须晚于被统计的源文件，否则数据不代表当前代码。
 *   2. 地板必须真的在地板上：实测高于地板 + maxHeadroomPct 时失败，必须 --update 收紧。
 *      （曾出现实际 62.77% / 地板 48%，等于容许 14 点无声下滑。）
 *
 * tolerancePct 同时吸收测量抖动与跨环境差异（地板常在本机测、CI 跑 ubuntu），
 * 避免首次 CI 因平台差异误红。maxHeadroomPct 必须大于 tolerancePct，否则
 * 合法的跨环境上浮会同时被当成「地板过低」。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASELINE_PATH = path.join(import.meta.dirname, "coverage-baseline.json");
const SUMMARY_PATH = path.join(REPO_ROOT, "coverage", "coverage-summary.json");

export const METRICS = ["statements", "branches", "functions", "lines"];

/** 缺省抬头：大于默认容差，又远小于历史上 14 点的空档。 */
export const DEFAULT_MAX_HEADROOM_PCT = 3;

export function allowStaleCoverage(argv, env) {
  return argv.includes("--allow-stale") || env.LAWMIND_ALLOW_STALE_COVERAGE === "1";
}

/**
 * @returns {{ key: string, kind: "below" | "headroom", value: number, floor: number }[]}
 */
export function evaluateCoverageRatchet(current, floors, { tolerancePct, maxHeadroomPct }) {
  const failures = [];
  for (const key of METRICS) {
    const floor = floors[key];
    const value = current[key];
    const minAllowed = floor - tolerancePct;
    const maxAllowed = floor + maxHeadroomPct;
    if (value + 1e-9 < minAllowed) {
      failures.push({ key, kind: "below", value, floor });
    } else if (value - 1e-9 > maxAllowed) {
      failures.push({ key, kind: "headroom", value, floor });
    }
  }
  return failures;
}

function loadBaseline() {
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  const tolerancePct = typeof raw.tolerancePct === "number" ? raw.tolerancePct : 0.5;
  const maxHeadroomPct =
    typeof raw.maxHeadroomPct === "number" ? raw.maxHeadroomPct : DEFAULT_MAX_HEADROOM_PCT;
  const floors = raw.floors ?? {};
  for (const key of METRICS) {
    if (typeof floors[key] !== "number") {
      throw new Error(`coverage-baseline.json missing floors.${key}`);
    }
  }
  if (!(maxHeadroomPct > tolerancePct)) {
    throw new Error(
      `coverage-baseline.json maxHeadroomPct (${maxHeadroomPct}) must be greater than tolerancePct (${tolerancePct})`,
    );
  }
  return { tolerancePct, maxHeadroomPct, floors, description: raw.description };
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

function writeBaseline(floors, tolerancePct, maxHeadroomPct, description) {
  const payload = {
    description:
      description ??
      "Coverage ratchet floors (see scripts/pre-commit/check-coverage-ratchet.mjs). Update with --update after intentional coverage gains.",
    tolerancePct,
    maxHeadroomPct,
    floors,
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function formatFailure(failure, tolerancePct, maxHeadroomPct) {
  const { key, kind, value, floor } = failure;
  if (kind === "below") {
    return `[coverage-ratchet] ${key}: ${value.toFixed(2)}% < floor ${floor.toFixed(2)}% (tolerance ${tolerancePct}%)\n`;
  }
  return (
    `[coverage-ratchet] ${key}: ${value.toFixed(2)}% is above floor ${floor.toFixed(2)}% by more than maxHeadroomPct ${maxHeadroomPct}%.\n` +
    "  地板远低于实测，之后可以无声跌回旧地板。请审查后运行 --update 收紧。\n"
  );
}

function main() {
  const update = process.argv.includes("--update");
  const allowStale = allowStaleCoverage(process.argv, process.env);
  const { tolerancePct, maxHeadroomPct, floors, description } = loadBaseline();

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
    writeBaseline(current, tolerancePct, maxHeadroomPct, description);
    process.stderr.write(
      `[coverage-ratchet] Updated ${path.relative(REPO_ROOT, BASELINE_PATH)} from current run.\n`,
    );
    for (const key of METRICS) {
      process.stderr.write(`  ${key}: ${current[key].toFixed(2)}%\n`);
    }
    process.exit(0);
  }

  const failures = evaluateCoverageRatchet(current, floors, { tolerancePct, maxHeadroomPct });
  for (const key of METRICS) {
    const failure = failures.find((item) => item.key === key);
    if (failure) {
      process.stderr.write(formatFailure(failure, tolerancePct, maxHeadroomPct));
    } else {
      process.stderr.write(
        `[coverage-ratchet] ${key}: ${current[key].toFixed(2)}% (floor ${floors[key].toFixed(2)}%)\n`,
      );
    }
  }

  if (failures.length > 0) {
    const below = failures.filter((item) => item.kind === "below").length;
    const headroom = failures.length - below;
    process.stderr.write(
      `[coverage-ratchet] ${failures.length} metric(s) outside ratchet` +
        ` (${below} below, ${headroom} headroom)` +
        " — add tests or run with --update after review.\n",
    );
    process.exit(1);
  }

  process.exit(0);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  main();
}
