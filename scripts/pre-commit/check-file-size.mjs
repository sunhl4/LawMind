#!/usr/bin/env node
/**
 * Enforce Phase 12 soft line limits (see CONTRIBUTING.md).
 *
 * 这是一个**棘轮**（与 scripts/pre-commit/check-coverage-ratchet.mjs 同一形状与出口）：
 * 允许存量超标文件留在 file-size-baseline.json 里冻结，但不允许它们继续长大，
 * 也不允许陈旧条目赖着不走。三种失败：
 *
 *   1. NEW      新文件超软上限，且未登记     → 先拆；登记需显式 --update
 *   2. STALE    已登记但现在不再超标         → 删条目（文件已拆小，条目失去意义）
 *   3. GROWN    已登记但超过冻结上限 + 容差  → 先拆；抬上限需显式 --update
 *   1/2/3 之外还有 MISSING：条目指向的文件已不存在 → 删条目
 *
 * 为什么要 STALE / GROWN 这两条（对标的失败模式）：
 *   - 只查「新超标」的清单会腐烂：文件拆小了条目还留着，清单越看越像"这些都是必须大的"，
 *     实际早已失真。insta 的 unreferenced snapshot 拒绝（`--unreferenced=reject`）同理。
 *   - 只警告不冻结，等于对最需要关注的大文件毫无约束：2542 行的文件可以一路长到 5000 行
 *     而 CI 全绿。冻结上限后，任何增长都必须在 diff 里显式出现。
 *
 *   node scripts/pre-commit/check-file-size.mjs
 *   node scripts/pre-commit/check-file-size.mjs --update   # 重写上限/清理陈旧条目
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASELINE_PATH = path.join(import.meta.dirname, "file-size-baseline.json");

/** 与 coverage 棘轮的 tolerancePct 同一用意：允许无意义的微小波动，但真增长必失败。 */
const DEFAULT_TOLERANCE_LINES = 10;

const LIMITS = [
  {
    label: "renderer",
    maxLines: 800,
    roots: [path.join(REPO_ROOT, "apps/lawmind-desktop/src/renderer")],
    extensions: new Set([".ts", ".tsx"]),
  },
  {
    label: "tools",
    maxLines: 600,
    roots: [path.join(REPO_ROOT, "src/lawmind/agent/tools")],
    extensions: new Set([".ts"]),
  },
];

/**
 * 读取基线。兼容旧格式（字符串数组 = 只有名单、无冻结上限），
 * 便于旧分支合并后仍能跑出可读结果，而不是直接崩。
 */
function loadBaseline() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return { toleranceLines: DEFAULT_TOLERANCE_LINES, entries: new Map() };
  }
  const toleranceLines =
    typeof raw.toleranceLines === "number" && Number.isFinite(raw.toleranceLines)
      ? Math.max(0, Math.floor(raw.toleranceLines))
      : DEFAULT_TOLERANCE_LINES;
  const entries = new Map();
  for (const { label } of LIMITS) {
    const section = raw[label];
    const map = new Map();
    if (Array.isArray(section)) {
      // 旧格式：无上限，仅登记。用 0 表示「上限未知」，由 --update 补写真实值。
      for (const rel of section) {
        if (typeof rel === "string") {
          map.set(rel.replace(/\\/g, "/"), null);
        }
      }
    } else if (section && typeof section === "object") {
      for (const [rel, ceiling] of Object.entries(section)) {
        map.set(rel.replace(/\\/g, "/"), typeof ceiling === "number" ? ceiling : null);
      }
    }
    entries.set(label, map);
  }
  return { toleranceLines, entries };
}

function writeBaseline(toleranceLines, ceilingsByLabel) {
  const payload = {
    description:
      "Grandfathered oversize files (Phase 12 soft limits). Values are frozen line ceilings: a file may not grow past ceiling + toleranceLines. New violations fail CI; stale entries (no longer oversize) also fail. Update with --update after a split or a reviewed, justified growth.",
    toleranceLines,
  };
  for (const { label } of LIMITS) {
    const map = ceilingsByLabel.get(label) ?? new Map();
    payload[label] = Object.fromEntries(
      [...map.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
    );
  }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function walkFiles(dir, extensions, out) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, extensions, out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (
      !extensions.has(ext) ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".test.tsx")
    ) {
      continue;
    }
    out.push(full);
  }
}

function countLines(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).length;
}

const update = process.argv.includes("--update");
const { toleranceLines, entries } = loadBaseline();

const failures = [];
const notices = [];
const nextCeilings = new Map(LIMITS.map(({ label }) => [label, new Map()]));

for (const { label, maxLines, roots, extensions } of LIMITS) {
  const files = [];
  for (const root of roots) {
    walkFiles(root, extensions, files);
  }
  const baseline = entries.get(label) ?? new Map();
  const seen = new Set();

  for (const filePath of files) {
    const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
    const lines = countLines(filePath);
    const ceiling = baseline.get(rel);
    const isOversize = lines > maxLines;

    if (baseline.has(rel)) {
      seen.add(rel);
      if (!isOversize) {
        // STALE：文件已拆到限内，条目失去意义。
        failures.push(
          `[file-size] ${label}: ${rel} 已不超标（${lines} ≤ ${maxLines}）但仍登记为豁免 —— 请删除该条目（pnpm 或直接 --update）。`,
        );
        continue;
      }
      if (ceiling === null) {
        // 旧格式条目：先补写真实上限。
        notices.push(
          `[file-size] ${label}: ${rel} 旧格式条目无冻结上限，--update 将以当前 ${lines} 行补写。`,
        );
        nextCeilings.get(label).set(rel, lines);
        continue;
      }
      if (lines > ceiling + toleranceLines) {
        failures.push(
          `[file-size] ${label}: ${rel} 超过冻结上限（${lines} > ${ceiling} + ${toleranceLines} 容差）—— 请拆分文件；确需增长请在 PR 里显式 --update 并说明理由。`,
        );
        nextCeilings.get(label).set(rel, lines);
        continue;
      }
      if (lines < ceiling - toleranceLines) {
        notices.push(
          `[file-size] ${label}: ${rel} 已缩到 ${lines} 行（上限 ${ceiling}）—— 可用 --update 收紧棘轮。`,
        );
      }
      nextCeilings.get(label).set(rel, Math.min(ceiling, lines));
      continue;
    }

    if (!isOversize) {
      continue;
    }
    // NEW：先拆文件，而不是往基线里加；加也必须是显式动作。
    failures.push(
      `[file-size] ${label}: ${rel} 有 ${lines} 行（软上限 ${maxLines}）且未登记 —— 请先拆分；确需豁免用 --update 显式登记上限。`,
    );
  }

  for (const rel of baseline.keys()) {
    if (seen.has(rel)) {
      continue;
    }
    const abs = path.join(REPO_ROOT, rel);
    failures.push(
      fs.existsSync(abs)
        ? `[file-size] ${label}: ${rel} 条目未被检查到（不在扫描范围）—— 请核对条目或移除。`
        : `[file-size] ${label}: ${rel} 条目指向的文件已不存在 —— 请移除该条目。`,
    );
  }
}

if (update) {
  writeBaseline(toleranceLines, nextCeilings);
  process.stderr.write(
    `[file-size] 已重写 ${path.relative(REPO_ROOT, BASELINE_PATH)}（toleranceLines=${toleranceLines}）\n`,
  );
  for (const { label } of LIMITS) {
    for (const [rel, ceiling] of nextCeilings.get(label) ?? new Map()) {
      process.stderr.write(`  ${label}: ${rel} → ${ceiling}\n`);
    }
  }
  process.exit(0);
}

for (const line of notices) {
  process.stderr.write(`${line}\n`);
}

const grandfathered = LIMITS.reduce((n, { label }) => n + (entries.get(label)?.size ?? 0), 0);
if (grandfathered > 0) {
  process.stderr.write(`[file-size] 冻结在案的存量超标文件：${grandfathered} 个。\n`);
}

if (failures.length > 0) {
  for (const line of failures) {
    process.stderr.write(`${line}\n`);
  }
  process.stderr.write(`[file-size] ${failures.length} 处问题 — CI blocked。\n`);
  process.exit(1);
}

process.exit(0);
