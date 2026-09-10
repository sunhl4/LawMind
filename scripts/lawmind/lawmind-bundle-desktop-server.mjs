#!/usr/bin/env node
/**
 * Bundle LawMind desktop local server with workspace-local esbuild (pnpm devDependency).
 * Uses the JS API — do not spawn `bin/esbuild` via `node` (that path is a native binary).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outfile = path.join(repoRoot, "apps/lawmind-desktop/server/dist/lawmind-local-server.cjs");
const entry = path.join(repoRoot, "apps/lawmind-desktop/server/lawmind-local-server.ts");
const childOutfile = path.join(
  repoRoot,
  "apps/lawmind-desktop/server/dist/analysis-sandbox-child.cjs",
);
const childEntry = path.join(repoRoot, "src/lawmind/agent/tools/legal/analysis-sandbox-child.ts");

fs.mkdirSync(path.dirname(outfile), { recursive: true });

try {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile,
  });
  await esbuild.build({
    entryPoints: [childEntry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: childOutfile,
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}