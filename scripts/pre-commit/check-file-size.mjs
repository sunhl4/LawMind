#!/usr/bin/env node
/**
 * Enforce Phase 12 soft line limits (see CONTRIBUTING.md).
 * - Grandfathered paths in file-size-baseline.json: warn only.
 * - New oversize files: fail (exit 1).
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASELINE_PATH = path.join(import.meta.dirname, "file-size-baseline.json");

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

function loadBaseline() {
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    const out = new Map();
    for (const { label } of LIMITS) {
      const list = Array.isArray(raw[label]) ? raw[label] : [];
      out.set(label, new Set(list.map((p) => p.replace(/\\/g, "/"))));
    }
    return out;
  } catch {
    return new Map(LIMITS.map(({ label }) => [label, new Set()]));
  }
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

const baseline = loadBaseline();
let warnCount = 0;
let failCount = 0;

for (const { label, maxLines, roots, extensions } of LIMITS) {
  const files = [];
  for (const root of roots) {
    walkFiles(root, extensions, files);
  }
  const allowed = baseline.get(label) ?? new Set();
  for (const filePath of files) {
    const lines = countLines(filePath);
    if (lines <= maxLines) {
      continue;
    }
    const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
    const msg = `[file-size] ${label}: ${rel} has ${lines} lines (soft max ${maxLines})`;
    if (allowed.has(rel)) {
      process.stderr.write(`${msg} [grandfathered]\n`);
      warnCount += 1;
    } else {
      process.stderr.write(`${msg} [NEW — add to baseline only after split PR]\n`);
      failCount += 1;
    }
  }
}

if (warnCount > 0) {
  process.stderr.write(`[file-size] ${warnCount} grandfathered file(s) exceed soft limits.\n`);
}
if (failCount > 0) {
  process.stderr.write(`[file-size] ${failCount} new oversize file(s) — CI blocked.\n`);
  process.exit(1);
}

process.exit(0);
