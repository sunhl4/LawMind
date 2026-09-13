import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const rendererRoot = here;
const entry = path.join(rendererRoot, "main.tsx");

const FORBIDDEN_SPEC_RE =
  /(?:cases\/index|learning\/suggestion-queue|memory\/index|deliverables\/index|drafts\/index|audit\/hash-chain|agent\/world-state|agent\/turn-plan\.(?:ts|js))/;

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) {
    return spec;
  }
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      /* ignore */
    }
  }
  if (base.endsWith(".js")) {
    const ts = `${base.slice(0, -3)}.ts`;
    const tsx = `${base.slice(0, -3)}.tsx`;
    if (fs.existsSync(ts)) {
      return ts;
    }
    if (fs.existsSync(tsx)) {
      return tsx;
    }
  }
  return null;
}

function extractSpecs(src: string): Array<{ spec: string; isType: boolean }> {
  const specs: Array<{ spec: string; isType: boolean }> = [];
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const re = /(?:import|export)\s+(type\s+)?(?:[\s\S]*?from\s+)?["']([^"']+)["']/g;
  let match = re.exec(stripped);
  while (match) {
    specs.push({ spec: match[2] ?? "", isType: Boolean(match[1]) });
    match = re.exec(stripped);
  }
  const dyn = /import\(\s*["']([^"']+)["']\s*\)/g;
  let dynMatch = dyn.exec(stripped);
  while (dynMatch) {
    specs.push({ spec: dynMatch[1] ?? "", isType: false });
    dynMatch = dyn.exec(stripped);
  }
  return specs;
}

function walkRendererValueGraph(): string[] {
  const visited = new Set<string>();
  const queue = [entry];
  const nodeBuiltinFiles: string[] = [];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || visited.has(file)) {
      continue;
    }
    visited.add(file);
    if (!file.startsWith(repoRoot) || file.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) {
      continue;
    }
    let src: string;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (/from ["']node:(crypto|fs|path)["']/.test(src)) {
      nodeBuiltinFiles.push(path.relative(repoRoot, file));
    }
    for (const { spec, isType } of extractSpecs(src)) {
      if (isType) {
        continue;
      }
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        continue;
      }
      const resolved = resolveImport(file, spec);
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return nodeBuiltinFiles;
}

function listRendererSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules") {
        continue;
      }
      out.push(...listRendererSourceFiles(abs));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(ent.name) || /\.test\.(ts|tsx)$/.test(ent.name)) {
      continue;
    }
    out.push(abs);
  }
  return out;
}

describe("renderer node builtin hygiene", () => {
  it("does not value-import node:crypto / node:fs / node:path", () => {
    expect(walkRendererValueGraph()).toEqual([]);
  });

  it("does not import Node-only lawmind barrels (including import type)", () => {
    const hits: string[] = [];
    for (const file of listRendererSourceFiles(rendererRoot)) {
      const src = fs.readFileSync(file, "utf8");
      if (FORBIDDEN_SPEC_RE.test(src)) {
        hits.push(path.relative(repoRoot, file));
      }
    }
    expect(hits).toEqual([]);
  });
});
