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

/** How many `clients/<id>/CLIENT_PROFILE.md` files exist (capped walk). */
export function countClientProfileFilesUnderClients(workspaceDir: string, maxScan = 200): number {
  const clientsDir = path.join(path.resolve(workspaceDir), "clients");
  if (!fs.existsSync(clientsDir) || !fs.statSync(clientsDir).isDirectory()) {
    return 0;
  }
  let n = 0;
  let scanned = 0;
  for (const name of fs.readdirSync(clientsDir)) {
    if (scanned++ >= maxScan) {
      break;
    }
    const p = path.join(clientsDir, name, "CLIENT_PROFILE.md");
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        n += 1;
      }
    } catch {
      // ignore
    }
  }
  return n;
}

export type MemoryTruthSourceFlags = {
  memoryMd: boolean;
  lawyerProfile: boolean;
  firmProfile: boolean;
  /** Optional workspace-root file (rare; primary client profiles live under `clients/`). */
  clientProfileRoot: boolean;
  clientProfileFilesUnderClients: number;
};

/**
 * O(1) file probes for /api/health (sync; no content read). Paths align with
 * `loadMemoryContext` / `buildAgentMemorySourceReport`.
 */
export function buildMemoryTruthSourceFlags(workspaceDir: string): MemoryTruthSourceFlags {
  const root = path.resolve(workspaceDir);
  const f = (rel: string) => {
    const p = path.join(root, rel);
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  return {
    memoryMd: f("MEMORY.md"),
    lawyerProfile: f("LAWYER_PROFILE.md"),
    firmProfile: f("FIRM_PROFILE.md"),
    clientProfileRoot: f("CLIENT_PROFILE.md"),
    clientProfileFilesUnderClients: countClientProfileFilesUnderClients(root),
  };
}

/** 读取 monorepo 根 package.json 的 version（桌面 dev 传 LAWMIND_REPO_ROOT；打包后可能不可用）。 */
export function tryReadWorkspacePackageVersion(repoRoot: string | undefined): string | null {
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
