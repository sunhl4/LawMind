#!/usr/bin/env node
/**
 * Headless workspace + health doctor (`pnpm lawmind:doctor -- --json`).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkspaceStandardReport } from "../../apps/lawmind-desktop/server/lawmind-health-payload.js";
import { scanMemoryManifest } from "../../src/lawmind/memory/relevant-recall.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function resolveWorkspace(): string {
  const env = process.env.LAWMIND_WORKSPACE_DIR?.trim();
  if (env) {
    return path.resolve(env);
  }
  return path.join(repoRoot, "workspace");
}

function main(): void {
  const json = process.argv.includes("--json");
  const workspaceDir = resolveWorkspace();
  const report = buildWorkspaceStandardReport(workspaceDir);
  const memoryEntries = scanMemoryManifest(workspaceDir);
  const payload = {
    ok: true,
    workspaceDir,
    report,
    memoryIndexCount: memoryEntries.length,
    timestamp: new Date().toISOString(),
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  console.log(`LawMind doctor — ${workspaceDir}`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`MEMORY manifest entries: ${memoryEntries.length}`);
}

main();
