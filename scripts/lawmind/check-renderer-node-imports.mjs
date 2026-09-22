#!/usr/bin/env node
/**
 * CI gate: renderer must not value-import engine modules that pull node: builtins.
 * Historical white screens came from Vite evaluating node:fs/path/crypto in the browser.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const rendererRoot = path.join(repoRoot, "apps/lawmind-desktop/src/renderer");
const engineRoot = path.join(repoRoot, "src/lawmind");

const IMPORT_RE = /(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_RE = /import\s+["']([^"']+)["']/g;
const NODE_BUILTIN_RE = /\bfrom\s+["']node:[^"']+["']|\brequire\s*\(\s*["']node:[^"']+["']\s*\)/;

/** @type {Set<string>} */
const visited = new Set();
/** @type {string[]} */
const offenders = [];

function resolveImport(fromFile, spec) {
  if (spec.startsWith("node:")) {
    return null;
  }
  if (!(spec.startsWith(".") || spec.startsWith("/") || spec.includes("src/lawmind"))) {
    return null;
  }
  let abs;
  if (spec.startsWith(".")) {
    abs = path.resolve(path.dirname(fromFile), spec);
  } else if (spec.includes("src/lawmind")) {
    const idx = spec.indexOf("src/lawmind");
    abs = path.join(repoRoot, spec.slice(idx));
  } else {
    return null;
  }
  const candidates = [
    abs,
    `${abs}.ts`,
    `${abs}.tsx`,
    `${abs}.js`,
    `${abs}.mjs`,
    path.join(abs, "index.ts"),
    path.join(abs, "index.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return c;
    }
  }
  return null;
}

function walk(file) {
  const norm = path.normalize(file);
  if (visited.has(norm)) {
    return;
  }
  visited.add(norm);
  if (!fs.existsSync(norm)) {
    return;
  }
  const text = fs.readFileSync(norm, "utf8");
  if (norm.startsWith(engineRoot) && NODE_BUILTIN_RE.test(text)) {
    offenders.push(path.relative(repoRoot, norm));
  }
  const specs = [];
  for (const re of [IMPORT_RE, SIDE_EFFECT_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      specs.push(m[1]);
    }
  }
  for (const spec of specs) {
    // Skip type-only import lines roughly: "import type" already excluded by IMPORT_RE.
    const resolved = resolveImport(norm, spec);
    if (!resolved) {
      continue;
    }
    if (resolved.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }
    if (resolved.startsWith(rendererRoot) || resolved.startsWith(engineRoot)) {
      walk(resolved);
    }
  }
}

const entry = path.join(rendererRoot, "main.tsx");
walk(entry);

if (offenders.length > 0) {
  console.error(
    "Renderer import graph pulls node: builtins (causes Electron white screen):\n" +
      offenders.map((f) => `  - ${f}`).join("\n") +
      "\nSplit browser-safe leaves (constants/types/pure helpers) and import those from the UI.",
  );
  process.exit(1);
}

console.log(`ok: scanned ${visited.size} modules from renderer main.tsx; no node: builtins.`);
