/**
 * Team memory cloud sync scaffold. The gate stays closed.
 *
 * `lawmind.policy.json` rejects `teamMemorySync` (commercial-policy: not a firm
 * hard boundary, and tokens must not live in the policy file). There is no env
 * or edition switch. `scanMemoryPathsForSecrets` remains for a future transport
 * that is not the policy file. Do not re-open the gate by reading a rejected key.
 */

import fs from "node:fs";
import path from "node:path";

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

/**
 * 上传门保持关闭。策略文件不接受团队记忆同步（地址和令牌不能写在那里）。
 * 以后要做内置同步，先走 scanMemoryPathsForSecrets，再另接传输，不要从策略文件把门打开。
 */
export function evaluateTeamMemorySyncGate(_workspaceDir: string): TeamMemorySyncGate {
  return { allowed: false, reason: "team_memory_sync_disabled" };
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
  _relativePaths: string[],
): TeamMemoryUploadPlan {
  const gate = evaluateTeamMemorySyncGate(workspaceDir);
  return {
    gate,
    scan: { ok: true, blockedPaths: [], scannedFiles: 0 },
  };
}
