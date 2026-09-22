#!/usr/bin/env node
/**
 * Headless workspace + health doctor (`pnpm lawmind:doctor -- --json`).
 * `--fix` 会就地修复会话历史的工具调用配对（session.json 与 transcript.jsonl）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkspaceStandardReport } from "../../apps/lawmind-desktop/server/lawmind-health-payload.js";
import { repairSessionHistoryIntegrity } from "../../src/lawmind/insights/session-history-integrity.js";
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
  const fix = process.argv.includes("--fix");
  const workspaceDir = resolveWorkspace();
  const repair = fix ? repairSessionHistoryIntegrity(workspaceDir) : undefined;
  const report = buildWorkspaceStandardReport(workspaceDir);
  const memoryEntries = scanMemoryManifest(workspaceDir);
  const payload = {
    ok: true,
    workspaceDir,
    report,
    memoryIndexCount: memoryEntries.length,
    ...(repair ? { repair } : {}),
    timestamp: new Date().toISOString(),
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  console.log(`LawMind doctor — ${workspaceDir}`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`MEMORY manifest entries: ${memoryEntries.length}`);
  if (repair) {
    console.log(
      `会话历史修复：扫描 ${repair.scannedSessions} 个会话，修复 ${repair.repairedSessionIds.length} 个 session.json、${repair.repairedTranscriptIds.length} 个 transcript.jsonl。`,
    );
    if (repair.repairedSessionIds.length > 0) {
      console.log(`  - ${repair.repairedSessionIds.join("\n  - ")}`);
    }
  } else {
    console.log("提示：加 --fix 可修复会话历史里的工具调用配对损坏。");
  }
}

main();
