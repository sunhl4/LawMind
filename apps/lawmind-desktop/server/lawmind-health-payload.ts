/**
 * Doctor / health 扩展字段（纯函数，便于单测；由 lawmind-local-server 组装进 /api/health）。
 */

import fs from "node:fs";
import path from "node:path";
import { listDrafts } from "../../../src/lawmind/drafts/index.js";
import { listTaskRecords } from "../../../src/lawmind/tasks/index.js";

export function countAuditJsonlFiles(workspaceDir: string): number {
  const dir = path.join(workspaceDir, "audit");
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

/** Persisted `ResearchBundle` sidecars next to draft JSON (`*.research.json`). */
export function countResearchSnapshots(workspaceDir: string): number {
  const dir = path.join(workspaceDir, "drafts");
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(".research.json")).length;
  } catch {
    return 0;
  }
}

export type LawMindDoctorStats = {
  auditJsonlFileCount: number;
  researchSnapshotCount: number;
  taskCount: number;
  draftCount: number;
};

export function buildDoctorStats(workspaceDir: string): LawMindDoctorStats {
  return {
    auditJsonlFileCount: countAuditJsonlFiles(workspaceDir),
    researchSnapshotCount: countResearchSnapshots(workspaceDir),
    taskCount: listTaskRecords(workspaceDir).length,
    draftCount: listDrafts(workspaceDir).length,
  };
}

/** 读取 monorepo 根 package.json 的 version（桌面 dev 传 LAWMIND_REPO_ROOT；打包后可能不可用）。 */
export function tryReadOpenClawPackageVersion(repoRoot: string | undefined): string | null {
  const raw = repoRoot?.trim();
  if (!raw) {
    return null;
  }
  try {
    const pkgPath = path.join(path.resolve(raw), "package.json");
    const j = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return typeof j.version === "string" ? j.version : null;
  } catch {
    return null;
  }
}
