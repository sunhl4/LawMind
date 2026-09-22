/**
 * CASE.md living layer (M3-lite): last-synced baseline + line merge rematerialize.
 * Full Loro/Yjs CRDT remains optional; this closes silent overwrite and empty merges.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";
import { replicaRoot } from "./paths.js";
import { listRecordOps, readCaseMdExcerpt } from "./record-ops.js";

export type CaseMdLiveState = {
  version: 1;
  matterId: string;
  /** SHA-256 of last rematerialized / accepted CASE.md body */
  baselineSha256: string;
  updatedAt: string;
};

function casePath(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", assertSafeMatterId(matterId), "CASE.md");
}

export function caseMdLiveStatePath(workspaceDir: string, matterId: string): string {
  return path.join(replicaRoot(workspaceDir, assertSafeMatterId(matterId)), "case-md-live.json");
}

function shaOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function readCaseMdLiveState(
  workspaceDir: string,
  matterId: string,
): CaseMdLiveState | null {
  const p = caseMdLiveStatePath(workspaceDir, matterId);
  try {
    if (!fs.existsSync(p)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<CaseMdLiveState>;
    if (raw?.version !== 1 || typeof raw.baselineSha256 !== "string") {
      return null;
    }
    return {
      version: 1,
      matterId: typeof raw.matterId === "string" ? raw.matterId : matterId,
      baselineSha256: raw.baselineSha256,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeCaseMdLiveState(
  workspaceDir: string,
  matterId: string,
  baselineSha256: string,
): CaseMdLiveState {
  const mid = assertSafeMatterId(matterId);
  const next: CaseMdLiveState = {
    version: 1,
    matterId: mid,
    baselineSha256,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(replicaRoot(workspaceDir, mid), { recursive: true });
  writeJsonAtomic(caseMdLiveStatePath(workspaceDir, mid), next);
  return next;
}

/** Line-based 3-way merge: keep lines present in either side when base matches. */
export function mergeCaseMdLines(
  base: string,
  local: string,
  remote: string,
): {
  merged: string;
  clean: boolean;
} {
  if (local === remote) {
    return { merged: local, clean: true };
  }
  if (local === base) {
    return { merged: remote, clean: true };
  }
  if (remote === base) {
    return { merged: local, clean: true };
  }
  const baseLines = base.split("\n");
  const localLines = local.split("\n");
  const remoteLines = remote.split("\n");
  // Prefer remote for length-dominant narrative when both diverged — mark unclean
  // so callers still park an excerpt; use a union of unique non-empty lines as draft.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of [...baseLines, ...localLines, ...remoteLines]) {
    const key = line.trimEnd();
    if (!key) {
      if (out.length === 0 || out[out.length - 1] !== "") {
        out.push("");
      }
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(line);
  }
  return { merged: out.join("\n").replace(/\n{3,}/g, "\n\n"), clean: false };
}

export type CaseMdRematerializeResult = {
  action: "unchanged" | "applied_remote" | "merged" | "conflict";
  localSha256: string;
  remoteSha256?: string;
  sidecarRel?: string;
};

/**
 * After ops merge: try to rematerialize remote CASE snapshot into local CASE.md.
 * Never silently clobber when both sides diverged from baseline.
 */
export function rematerializeCaseMd(
  workspaceDir: string,
  matterId: string,
): CaseMdRematerializeResult {
  const mid = assertSafeMatterId(matterId);
  const abs = casePath(workspaceDir, mid);
  let local = "";
  try {
    local = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  } catch {
    local = "";
  }
  const localSha = local ? shaOf(local) : "";
  const snaps = listRecordOps(workspaceDir, mid)
    .filter((op) => op.kind === "case_md.snapshot")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = snaps.at(-1);
  if (!latest) {
    if (localSha) {
      writeCaseMdLiveState(workspaceDir, mid, localSha);
    }
    return { action: "unchanged", localSha256: localSha };
  }
  const remoteSha = typeof latest.payload.sha256 === "string" ? latest.payload.sha256 : "";
  const remoteExcerpt = readCaseMdExcerpt(workspaceDir, mid, latest);
  if (!remoteSha || remoteSha === localSha) {
    if (localSha) {
      writeCaseMdLiveState(workspaceDir, mid, localSha);
    }
    return { action: "unchanged", localSha256: localSha, remoteSha256: remoteSha };
  }

  const state = readCaseMdLiveState(workspaceDir, mid);
  const base = ""; // excerpts only — full base not stored; treat empty base
  // If local empty, adopt remote excerpt as starting CASE.md
  if (!local.trim() && remoteExcerpt.trim()) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, remoteExcerpt, "utf8");
    const nextSha = shaOf(remoteExcerpt);
    writeCaseMdLiveState(workspaceDir, mid, nextSha);
    return { action: "applied_remote", localSha256: nextSha, remoteSha256: remoteSha };
  }

  // Both have content and differ — attempt line merge of local vs excerpt
  const { merged, clean } = mergeCaseMdLines(base, local, remoteExcerpt);
  if (clean && merged !== local) {
    fs.writeFileSync(abs, merged, "utf8");
    const nextSha = shaOf(merged);
    writeCaseMdLiveState(workspaceDir, mid, nextSha);
    return { action: "merged", localSha256: nextSha, remoteSha256: remoteSha };
  }

  // Diverged: keep local, park remote excerpt (detectAndParkCaseMdConflict also runs)
  const sidecarRel = `cases/${mid}/CASE（冲突摘录）.md`;
  void state;
  return {
    action: "conflict",
    localSha256: localSha,
    remoteSha256: remoteSha,
    sidecarRel,
  };
}
