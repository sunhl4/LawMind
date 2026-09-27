#!/usr/bin/env node
/**
 * Headless workspace doctor (`pnpm lawmind:doctor`).
 * 人读的输出先给三行巡检（会话 / 投影 / 索引）。`--json` 仍附上工作区标准报告。
 * `--fix` 就地修复会话历史的工具调用配对（session.json 与 transcript.jsonl）。
 * 投影对不上、或自定义技能因签名停用时，退出码为 1。会话配对和缺索引会自己好，不因此失败。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkspaceStandardReport } from "../../apps/lawmind-desktop/server/lawmind-health-payload.js";
import { repairSessionHistoryIntegrity } from "../../src/lawmind/insights/session-history-integrity.js";
import { scanMemoryManifest } from "../../src/lawmind/memory/relevant-recall.js";
import { gatherOpsDoctorSnapshot } from "../../src/lawmind/platform/ops-doctor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function resolveWorkspace(): string {
  const env = process.env.LAWMIND_WORKSPACE_DIR?.trim();
  if (env) {
    return path.resolve(env);
  }
  return path.join(repoRoot, "workspace");
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const fix = process.argv.includes("--fix");
  const workspaceDir = resolveWorkspace();
  const repair = fix ? repairSessionHistoryIntegrity(workspaceDir) : undefined;
  const snapshot = await gatherOpsDoctorSnapshot(workspaceDir);
  const report = buildWorkspaceStandardReport(workspaceDir);
  const memoryEntries = scanMemoryManifest(workspaceDir);
  const payload = {
    ok: !snapshot.projectionDrift && snapshot.unsignedSkillCount === 0,
    workspaceDir,
    ops: snapshot,
    report,
    memoryIndexCount: memoryEntries.length,
    ...(repair ? { repair } : {}),
    timestamp: new Date().toISOString(),
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = snapshot.projectionDrift || snapshot.unsignedSkillCount > 0 ? 1 : 0;
    return;
  }
  console.log(`LawMind doctor — ${workspaceDir}`);
  for (const line of snapshot.lines) {
    console.log(line);
  }
  const pending = report.checks.filter((check) => check.state !== "ok");
  if (pending.length > 0) {
    console.log("");
    console.log("工作区文件（缺了不挡交办）：");
    for (const check of pending) {
      console.log(`  - ${check.label}：${check.hint}`);
    }
  }
  console.log(`记忆索引条目：${memoryEntries.length}`);
  if (repair) {
    console.log(
      `会话历史修复：扫描 ${repair.scannedSessions} 个会话，修复 ${repair.repairedSessionIds.length} 个 session.json、${repair.repairedTranscriptIds.length} 个 transcript.jsonl。`,
    );
  }
  process.exitCode = snapshot.projectionDrift || snapshot.unsignedSkillCount > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("[LawMind] doctor failed:", err);
  process.exitCode = 1;
});
