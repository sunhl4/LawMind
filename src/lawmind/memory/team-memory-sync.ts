/**
 * Team Memory cloud sync scaffold (P2). Opt-in only; default OFF.
 * Firm edition + explicit `lawmind.policy.json` `teamMemorySync.enabled` required.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveEdition } from "../policy/edition.js";
import {
  readWorkspacePolicyFile,
  type LawMindWorkspacePolicy,
} from "../policy/workspace-policy.js";

/** Patterns that block upload when found in file content (secret scan). */
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsk-[a-zA-Z0-9]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/u,
  /\bBearer\s+[a-zA-Z0-9._-]{20,}\b/u,
  /\bapi[_-]?key\s*[:=]\s*['"]?[a-zA-Z0-9._-]{16,}/iu,
];

export type TeamMemorySyncGate = {
  allowed: boolean;
  reason: string;
};

export type TeamMemoryScanResult = {
  ok: boolean;
  blockedPaths: string[];
  scannedFiles: number;
};

export function isTeamMemorySyncPolicyEnabled(
  policy: LawMindWorkspacePolicy | null | undefined,
): boolean {
  return policy?.teamMemorySync?.enabled === true;
}

/**
 * Whether team memory sync may run for this workspace.
 * Requires firm edition and explicit policy opt-in.
 */
export function evaluateTeamMemorySyncGate(workspaceDir: string): TeamMemorySyncGate {
  const policy = readWorkspacePolicyFile(workspaceDir);
  if (!isTeamMemorySyncPolicyEnabled(policy)) {
    return { allowed: false, reason: "team_memory_sync_disabled" };
  }
  const edition = resolveEdition({ policy });
  if (edition.edition !== "firm") {
    return { allowed: false, reason: "team_memory_sync_requires_firm_edition" };
  }
  const endpoint = policy?.teamMemorySync?.endpoint?.trim();
  if (!endpoint) {
    return { allowed: false, reason: "team_memory_sync_endpoint_missing" };
  }
  return { allowed: true, reason: "ok" };
}

function isSafeMemoryRel(rel: string): boolean {
  const n = rel.replace(/\\/g, "/").trim();
  return n.length > 0 && !n.includes("..") && !path.isAbsolute(n);
}

/**
 * Scan candidate memory files for secret-like content before any upload.
 */
export function scanMemoryPathsForSecrets(
  workspaceDir: string,
  relativePaths: string[],
): TeamMemoryScanResult {
  const root = path.resolve(workspaceDir);
  const blockedPaths: string[] = [];
  let scannedFiles = 0;
  for (const rel of relativePaths) {
    if (!isSafeMemoryRel(rel)) {
      blockedPaths.push(rel);
      continue;
    }
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      blockedPaths.push(rel);
      continue;
    }
    let raw = "";
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        continue;
      }
      raw = fs.readFileSync(abs, "utf8");
      scannedFiles += 1;
    } catch {
      blockedPaths.push(rel);
      continue;
    }
    if (SECRET_PATTERNS.some((re) => re.test(raw))) {
      blockedPaths.push(rel);
    }
  }
  return { ok: blockedPaths.length === 0, blockedPaths, scannedFiles };
}

export type TeamMemoryUploadPlan = {
  gate: TeamMemorySyncGate;
  scan: TeamMemoryScanResult;
  endpoint?: string;
};

/**
 * Build an upload plan (no network I/O). Callers use this before any future sync transport.
 */
export function planTeamMemoryUpload(
  workspaceDir: string,
  relativePaths: string[],
): TeamMemoryUploadPlan {
  const gate = evaluateTeamMemorySyncGate(workspaceDir);
  if (!gate.allowed) {
    return {
      gate,
      scan: { ok: true, blockedPaths: [], scannedFiles: 0 },
    };
  }
  const policy = readWorkspacePolicyFile(workspaceDir);
  const scan = scanMemoryPathsForSecrets(workspaceDir, relativePaths);
  return {
    gate,
    scan,
    endpoint: policy?.teamMemorySync?.endpoint?.trim(),
  };
}
