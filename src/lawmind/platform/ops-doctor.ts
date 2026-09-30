/**
 * 给 `pnpm lawmind:doctor` 和 `pnpm lawmind:ops doctor` 用的同一份巡检。
 * 会话工具配对、案件投影漂移、检索索引，外加本机执行面清单（持久 / 可重建 / 凭据）。
 */
import { checkMatterConsistency } from "../application/matter-consistency.js";
import { computeSearchIndexFreshness, getSearchIndexStatus } from "../indexing/fts-search.js";
import { scanSessionHistoryIntegrity } from "../insights/session-history-integrity.js";
import { listLocalSkills } from "../skills/skill-runtime.js";
import { buildExecutionSurfaceReport } from "./execution-surface.js";

export type OpsDoctorSnapshot = {
  lines: string[];
  /** 投影漂移不会在下一轮对话里自己修好。 */
  projectionDrift: boolean;
  corruptSessionCount: number;
  projectionIssueCount: number;
  unsignedSkillCount: number;
  indexReady: boolean;
  staleReason?: string;
};

export function formatOpsDoctorSnapshot(input: {
  scannedSessions: number;
  corruptSessionCount: number;
  repairableDriftCount: number;
  orphanMatterCount: number;
  unsignedSkillCount: number;
  indexReady: boolean;
  stale: boolean;
  staleReason?: string;
}): OpsDoctorSnapshot {
  const lines: string[] = [];
  if (input.corruptSessionCount === 0) {
    lines.push(`会话：最近 ${input.scannedSessions} 个会话的工具调用配对完好。`);
  } else {
    lines.push(
      `会话：${input.corruptSessionCount} 个会话的工具调用配对损坏。下一轮对话会自动补上；要立刻写回磁盘，运行 pnpm lawmind:doctor -- --fix。`,
    );
  }
  const projectionBits: string[] = [];
  if (input.repairableDriftCount > 0) {
    projectionBits.push(
      `${input.repairableDriftCount} 处字段漂移。运行 pnpm lawmind:ops matter-repair-projection。争点、风险、进展不算漂移`,
    );
  }
  if (input.orphanMatterCount > 0) {
    projectionBits.push(
      `${input.orphanMatterCount} 个档案没有 matter.json。运行 pnpm lawmind:ops matter-repair-projection 会按档案里的名称补上案件记录，不改争点、风险和进展`,
    );
  }
  if (projectionBits.length === 0) {
    lines.push("投影：CASE.md 的结构化字段与 matter.json 一致。");
  } else {
    lines.push(`投影：${projectionBits.join("。")}。`);
  }
  if (input.unsignedSkillCount > 0) {
    lines.push(
      `技能：${input.unsignedSkillCount} 个自定义技能签名未通过，已停用且不会在对话里报错。核对签名密钥后执行 pnpm lawmind:skills:sign --check。`,
    );
  }
  if (!input.indexReady || input.staleReason === "index_missing") {
    lines.push("索引：还没有。打开应用检索一次就会建；也可以在设置 → 体检里点「重建索引」。");
  } else if (input.staleReason === "sources_changed") {
    lines.push("索引：有文件改过，下一次检索会自动补上。不必整库重建。");
  } else if (input.stale) {
    lines.push(
      "索引：需要整库重建。在设置 → 体检里点「重建索引」。从桌面应用打开时不必再设环境变量。",
    );
  } else {
    lines.push("索引：就绪。");
  }
  lines.push(...buildExecutionSurfaceReport().lines);
  return {
    lines,
    projectionDrift: input.repairableDriftCount + input.orphanMatterCount > 0,
    corruptSessionCount: input.corruptSessionCount,
    projectionIssueCount: input.repairableDriftCount + input.orphanMatterCount,
    unsignedSkillCount: input.unsignedSkillCount,
    indexReady: input.indexReady,
    staleReason: input.staleReason,
  };
}

export async function gatherOpsDoctorSnapshot(workspaceDir: string): Promise<OpsDoctorSnapshot> {
  const integrity = scanSessionHistoryIntegrity(workspaceDir);
  const issues = await checkMatterConsistency(workspaceDir);
  const status = getSearchIndexStatus(workspaceDir);
  const fresh = computeSearchIndexFreshness(status);
  const unsignedSkillCount = listLocalSkills(workspaceDir).filter(
    (skill) => !skill.signatureOk,
  ).length;
  return formatOpsDoctorSnapshot({
    scannedSessions: integrity.scannedSessions,
    corruptSessionCount: integrity.corruptSessionCount,
    repairableDriftCount: issues.filter((issue) => issue.code !== "missing_matter_json").length,
    orphanMatterCount: issues.filter((issue) => issue.code === "missing_matter_json").length,
    unsignedSkillCount,
    indexReady: status.ready,
    stale: fresh.stale,
    staleReason: fresh.staleReason,
  });
}
