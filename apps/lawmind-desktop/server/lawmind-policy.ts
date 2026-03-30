/**
 * Optional workspace policy file: `lawmind.policy.json` next to workspace root.
 * Applied after `.env.lawmind` so IT can enforce guardrails without editing secrets.
 */

import fs from "node:fs";
import path from "node:path";

export type LawMindPolicyFile = {
  schemaVersion: number;
  /** When false, the desktop API forces web search off regardless of client toggle. */
  allowWebSearch?: boolean;
  /** `single` | `dual` — sets LAWMIND_RETRIEVAL_MODE for the server process. */
  retrievalMode?: string;
  /** When false, sets LAWMIND_ENABLE_COLLABORATION=false. */
  enableCollaboration?: boolean;
};

export type LawMindPolicyState =
  | { loaded: false }
  | {
      loaded: true;
      path: string;
      policy: LawMindPolicyFile;
      /** Human-readable keys that were applied to process.env */
      applied: string[];
    };

const POLICY_FILENAME = "lawmind.policy.json";

function parsePolicy(raw: string): LawMindPolicyFile | null {
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object") {
      return null;
    }
    const o = j as Record<string, unknown>;
    const schemaVersion = o.schemaVersion;
    if (typeof schemaVersion !== "number" || schemaVersion < 1) {
      return null;
    }
    return j as LawMindPolicyFile;
  } catch {
    return null;
  }
}

/**
 * Read policy from disk (no env mutation).
 */
export function readLawMindPolicyFile(workspaceDir: string): LawMindPolicyState {
  const abs = path.join(path.resolve(workspaceDir), POLICY_FILENAME);
  if (!fs.existsSync(abs)) {
    return { loaded: false };
  }
  const raw = fs.readFileSync(abs, "utf8");
  const policy = parsePolicy(raw);
  if (!policy) {
    return { loaded: false };
  }
  return { loaded: true, path: abs, policy, applied: [] };
}

/**
 * Apply supported policy fields to `process.env` (override prior values for these keys only).
 */
export function applyLawMindPolicyToEnv(policy: LawMindPolicyFile): string[] {
  const applied: string[] = [];
  if (policy.allowWebSearch === false) {
    process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH = "1";
    applied.push("forceNoWebSearch");
  } else {
    delete process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH;
  }
  const rm = policy.retrievalMode?.trim().toLowerCase();
  if (rm === "single" || rm === "dual") {
    process.env.LAWMIND_RETRIEVAL_MODE = rm;
    applied.push("retrievalMode");
  }
  if (policy.enableCollaboration === false) {
    process.env.LAWMIND_ENABLE_COLLABORATION = "false";
    applied.push("enableCollaboration");
  }
  return applied;
}

/**
 * Load from workspace and apply. Returns state for `/api/health`.
 */
export function loadAndApplyLawMindPolicy(workspaceDir: string): LawMindPolicyState {
  const read = readLawMindPolicyFile(workspaceDir);
  if (!read.loaded) {
    return { loaded: false };
  }
  const applied = applyLawMindPolicyToEnv(read.policy);
  return { loaded: true, path: read.path, policy: read.policy, applied };
}

export function isWebSearchForcedOffByPolicy(): boolean {
  return process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH === "1";
}
