#!/usr/bin/env node
/**
 * Bundle LawMind desktop local server with workspace-local esbuild (pnpm devDependency).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const localEsbuild = path.join(repoRoot, "node_modules", ".bin", "esbuild");
const outfile = path.join(repoRoot, "apps/lawmind-desktop/server/dist/lawmind-local-server.cjs");
const entry = path.join(repoRoot, "apps/lawmind-desktop/server/lawmind-local-server.ts");
const childOutfile = path.join(
  repoRoot,
  "apps/lawmind-desktop/server/dist/analysis-sandbox-child.cjs",
);
const childEntry = path.join(repoRoot, "src/lawmind/agent/tools/legal/analysis-sandbox-child.ts");

if (!fs.existsSync(localEsbuild)) {
  console.error(
    "esbuild not found at node_modules/.bin/esbuild — run `pnpm install` at repo root.",
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(outfile), { recursive: true });

const result = spawnSync(
  localEsbuild,
  [entry, "--bundle", "--platform=node", "--format=cjs", "--target=node22", `--outfile=${outfile}`],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const child = spawnSync(
  localEsbuild,
  [
    childEntry,
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--target=node22",
    `--outfile=${childOutfile}`,
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(child.status === 0 ? 0 : (child.status ?? 1));
