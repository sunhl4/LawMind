/**
 * 利益冲突扫描服务（P1.2）。
 *
 * 和旧工具的区别：
 * - 扫描是确定性字符串/当事人名匹配，不是模型一句话；每个命中都带来源案件和来源字段。
 * - 覆盖全部案件（含已结/前客户）与工作区记忆；已挂载的本机文件夹仍由
 *   `check_conflict_of_interest` 工具在自己的上下文里补扫，这里不做猜测。
 * - 扫描结果直接写进收案记录；命中不会自动拒绝，只把记录推到律师审核。
 */

import { loadMatter } from "../adapters/matter-storage/index.js";
import { buildMatterIndex, listMatterIds } from "../cases/index.js";
import { matterPartyIdentityNames, samePartyName } from "../desk/matter-parties.js";
import { loadMemoryContext } from "../memory/index.js";
import {
  beginConflictScan,
  loadAdmission,
  recordConflictScan,
  type AdmissionConflictHit,
  type AdmissionError,
  type AdmissionRecord,
} from "./admission.js";

export type ConflictScanResult = {
  scannedParties: string[];
  scannedMatters: number;
  scannedWorkspaceMemory: boolean;
  hits: AdmissionConflictHit[];
};

export type ConflictScanOutcome =
  | { ok: true; scan: ConflictScanResult; admission: AdmissionRecord }
  | { ok: false; error: AdmissionError | "scan_failed" };

function normalizeParties(parties: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parties) {
    const party = raw.trim().slice(0, 120);
    const key = party.toLowerCase();
    if (party.length < 2 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(party);
    if (out.length >= 32) {
      break;
    }
  }
  return out;
}

function statusNote(status: string | undefined): string {
  if (status === "closed") {
    return "（已结案件/前客户）";
  }
  return status ? `（${status}）` : "";
}

/**
 * 扫描候选当事人。命中按「他案 + 当事人」去重；同名命中不跨案合并。
 */
export async function scanConflictOfInterest(
  workspaceDir: string,
  parties: string[],
  opts?: { excludeMatterId?: string },
): Promise<ConflictScanResult> {
  const scannedParties = normalizeParties(parties);
  const exclude = opts?.excludeMatterId?.trim();
  const ids = (await listMatterIds(workspaceDir)).filter((id) => id !== exclude);
  const hits: AdmissionConflictHit[] = [];
  const hitKeys = new Set<string>();
  const push = (hit: AdmissionConflictHit) => {
    const key = `${hit.matterId}\u0000${hit.partyName}`;
    if (hitKeys.has(key) || hits.length >= 50) {
      return;
    }
    hitKeys.add(key);
    hits.push(hit);
  };

  for (const matterId of ids) {
    const rec = loadMatter(workspaceDir, matterId);
    const index = await buildMatterIndex(workspaceDir, matterId);
    const identityNames = rec ? matterPartyIdentityNames(rec) : [];
    const identityBlob = identityNames.join("\n").toLowerCase();
    const indexBlob = [
      index.caseMemory,
      ...index.coreIssues,
      ...index.taskGoals,
      ...index.riskNotes,
      ...index.progressEntries,
    ]
      .join("\n")
      .toLowerCase();
    for (const party of scannedParties) {
      const lower = party.toLowerCase();
      const identityHit =
        identityBlob.includes(lower) || identityNames.some((name) => samePartyName(name, party));
      if (identityHit) {
        push({
          matterId,
          matterTitle: rec?.title ?? matterId,
          partyName: party,
          reason: `「${party}」出现在他案当事人/案件身份${statusNote(rec?.status)}`,
          source: "matter_record",
        });
        continue;
      }
      if (indexBlob.includes(lower)) {
        push({
          matterId,
          matterTitle: rec?.title ?? matterId,
          partyName: party,
          reason: `「${party}」出现在他案卷宗索引（争点/风险/进展）${statusNote(rec?.status)}`,
          source: "matter_index",
        });
      }
    }
  }

  let scannedWorkspaceMemory = false;
  try {
    const memory = await loadMemoryContext(workspaceDir, {});
    const blob = [memory.general, memory.profile].join("\n").toLowerCase();
    scannedWorkspaceMemory = blob.trim().length > 0;
    for (const party of scannedParties) {
      if (blob.includes(party.toLowerCase())) {
        push({
          matterId: "(workspace-memory)",
          partyName: party,
          reason: `「${party}」出现在工作区记忆/律所画像`,
          source: "workspace_memory",
        });
      }
    }
  } catch {
    scannedWorkspaceMemory = false;
  }

  return {
    scannedParties,
    scannedMatters: ids.length,
    scannedWorkspaceMemory,
    hits: hits.toSorted((a, b) =>
      `${a.matterId}\u0000${a.partyName}`.localeCompare(`${b.matterId}\u0000${b.partyName}`),
    ),
  };
}

/**
 * 跑一轮收案冲突扫描并写回收案记录。
 * 没有候选当事人时拒绝扫描：空扫描不能当作「无冲突」。
 */
export async function scanAdmissionConflicts(
  workspaceDir: string,
  matterId: string,
  opts?: { by?: string; now?: Date },
): Promise<ConflictScanOutcome> {
  const admission = loadAdmission(workspaceDir, matterId);
  if (!admission) {
    return { ok: false, error: "not_found" };
  }
  if (admission.status === "accepted" || admission.status === "declined") {
    return { ok: false, error: "already_decided" };
  }
  const parties = normalizeParties(admission.candidates.map((row) => row.name));
  if (parties.length === 0) {
    return { ok: false, error: "no_candidates" };
  }
  const begun = beginConflictScan(workspaceDir, matterId, {
    by: opts?.by,
    note: `扫描 ${parties.length} 个候选当事人`,
    now: opts?.now,
  });
  if (!begun.ok) {
    return { ok: false, error: begun.error };
  }
  let scan: ConflictScanResult;
  try {
    scan = await scanConflictOfInterest(workspaceDir, parties, { excludeMatterId: matterId });
  } catch {
    return { ok: false, error: "scan_failed" };
  }
  const recorded = recordConflictScan(workspaceDir, matterId, {
    hits: scan.hits,
    by: opts?.by,
    note: `扫描 ${scan.scannedMatters} 个案件；命中 ${scan.hits.length} 条`,
    now: opts?.now,
  });
  if (!recorded.ok) {
    return { ok: false, error: recorded.error };
  }
  return { ok: true, scan, admission: recorded.admission };
}
