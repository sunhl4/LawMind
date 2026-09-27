/**
 * Optional workspace policy file: `lawmind.policy.json` next to workspace root.
 * Applied after `.env.lawmind` so IT can enforce guardrails without editing secrets.
 */

import path from "node:path";

import { listEditions } from "../../../src/lawmind/policy/edition.js";
import { effectivePolicyRows } from "../../../src/lawmind/policy/commercial-policy.js";
import {
  inspectWorkspacePolicyFile,
  resolveEgressMode,
} from "../../../src/lawmind/policy/workspace-policy.js";
import type { LawMindEdition, LawMindEgressMode, LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import type { PolicyKeyNote } from "../../../src/lawmind/policy/commercial-policy.js";

export type { LawMindEdition, LawMindEgressMode };

export type LawMindPolicyFile = {
  schemaVersion: number;
  /**
   * 出站总模式（唯一权威）：`"offline" | "allowlisted" | "open"`。
   * `"offline"` 等于旧的 `highSecurityMode: true`——完全不出站，律所级本地部署用。
   */
  egressMode?: LawMindEgressMode;
  /**
   * @deprecated 等价于 `egressMode: "offline"`，仅为兼容旧文件保留。
   */
  highSecurityMode?: boolean;
  /** When false, the desktop API forces web search off regardless of client toggle. */
  allowWebSearch?: boolean;
  /** `single` | `dual` — sets LAWMIND_RETRIEVAL_MODE for the server process. */
  retrievalMode?: string;
  /** When false, sets LAWMIND_ENABLE_COLLABORATION=false. */
  enableCollaboration?: boolean;
  /** Product edition (see `src/lawmind/policy/edition-features.ts`); also read via `LAWMIND_EDITION` env. */
  edition?: LawMindEdition;
  /**
   * Per-feature overrides on the edition table (same shape as workspace-policy `features`).
   * Unknown keys ignored at resolve time.
   */
  features?: Partial<Record<string, boolean>>;
  /** Injected into Agent system prompt (see `resolveAgentMandatoryRulesForPrompt`). */
  agentMandatoryRules?: string;
  /** Relative path under workspace; file content overrides inline when readable. */
  agentMandatoryRulesPath?: string;
  /** Overrides env `LAWMIND_AGENT_MAX_TOOL_CALLS` for Agent `runTurn` when set (clamped server-side). */
  agentMaxToolCallsPerTurn?: number;
  /** W10：是否采集产品级洞察事件（ux.matter_action）。 */
  productInsightsCollection?: "off" | "local-only" | "synced";
};

export type LawMindPolicyState =
  | { loaded: false; rejected?: PolicyKeyNote[] }
  | {
      loaded: true;
      path: string;
      policy: LawMindPolicyFile;
      /** 生效的策略合同键（不是环境变量副作用标签）。 */
      applied: string[];
      rejected?: PolicyKeyNote[];
      migrated?: PolicyKeyNote[];
    };

const POLICY_FILENAME = "lawmind.policy.json";

export function readLawMindPolicyFile(workspaceDir: string): LawMindPolicyState {
  const inspected = inspectWorkspacePolicyFile(workspaceDir);
  if (!inspected.policy) {
    return { loaded: false, rejected: inspected.rejected };
  }
  return {
    loaded: true,
    path: path.join(path.resolve(workspaceDir), POLICY_FILENAME),
    policy: inspected.policy,
    applied: effectivePolicyRows(inspected.policy).map((row) => row.key),
    rejected: inspected.rejected,
    migrated: inspected.migrated,
  };
}

/**
 * Apply supported policy fields to `process.env` (override prior values for these keys only).
 */
export function applyLawMindPolicyToEnv(policy: LawMindPolicyFile): string[] {
  const egressOffline = resolveEgressMode(policy) === "offline";
  if (egressOffline || policy.allowWebSearch === false) {
    process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH = "1";
  } else {
    delete process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH;
  }
  if (policy.enableCollaboration === false) {
    process.env.LAWMIND_ENABLE_COLLABORATION = "false";
  }
  const validEditions = new Set<string>(listEditions());
  if (policy.edition && validEditions.has(policy.edition)) {
    process.env.LAWMIND_EDITION = policy.edition;
  }
  return effectivePolicyRows(policy as LawMindWorkspacePolicy).map((row) => row.key);
}

/**
 * Load from workspace and apply. Returns state for `/api/health`.
 */
export function loadAndApplyLawMindPolicy(workspaceDir: string): LawMindPolicyState {
  const read = readLawMindPolicyFile(workspaceDir);
  if (!read.loaded) {
    return read;
  }
  const applied = applyLawMindPolicyToEnv(read.policy);
  return { ...read, applied };
}

export function isWebSearchForcedOffByPolicy(): boolean {
  return process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH === "1";
}

/**
 * Compose「联网」is independent of 权限 mode.
 * 「仅调研 / 计划模式」仍允许联网；不要把权限模式当成关网开关。
 */
export function resolveChatAllowWebSearch(requested: boolean): boolean {
  if (isWebSearchForcedOffByPolicy()) {
    return false;
  }
  return  requested;
}
