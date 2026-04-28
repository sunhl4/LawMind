/**
 * Workspace policy file: `lawmind.policy.json` (same path as desktop server).
 * Phase C adds optional keys for edition, benchmark gates, and governance reporting.
 * Desktop only applies keys it knows; the engine uses the full parsed object for analytics.
 */

import fs from "node:fs";
import path from "node:path";

const POLICY_FILENAME = "lawmind.policy.json";

/** Max chars injected into Agent system prompt from policy (inline or file). */
export const AGENT_MANDATORY_RULES_MAX_CHARS = 8192;

/** Product packaging tier (labels, governance defaults). */
export type LawMindEdition = "solo" | "firm" | "private_deploy";

/**
 * Parsed `lawmind.policy.json`.
 * `schemaVersion` >= 1 is required; other fields optional.
 */
export type LawMindWorkspacePolicy = {
  schemaVersion: number;
  description?: string;
  allowWebSearch?: boolean;
  retrievalMode?: string;
  enableCollaboration?: boolean;
  /** Phase C: edition for UI / reports */
  edition?: LawMindEdition;
  /** Phase C: minimum mean benchmark score (0–1) for release / CI gate */
  benchmarkGateMinScore?: number;
  /** Phase C: hint for audit export cadence (e.g. P7D) — documentation-first */
  auditExportCadenceHint?: string;
  /**
   * Short markdown/plaintext rules always prepended to Agent system prompt (after core principles).
   * If `agentMandatoryRulesPath` is set and resolves to a readable file, file content wins; otherwise this field is used.
   */
  agentMandatoryRules?: string;
  /**
   * Path relative to workspace root (no `..`). File must be UTF-8 text; content is capped at AGENT_MANDATORY_RULES_MAX_CHARS.
   */
  agentMandatoryRulesPath?: string;
  /**
   * Cap on Agent `runTurn` tool-call iterations (default from env `LAWMIND_AGENT_MAX_TOOL_CALLS` or 15).
   * When set, must be a positive integer (clamped to 50 server-side).
   */
  agentMaxToolCallsPerTurn?: number;
};

export type ResolvedAgentMandatoryRules = {
  active: boolean;
  truncated: boolean;
  text: string;
};

function isSafeRelativeWorkspacePath(rel: string): boolean {
  const t = rel.trim();
  if (!t || t.length > 512) {
    return false;
  }
  const norm = path.normalize(t);
  if (path.isAbsolute(norm)) {
    return false;
  }
  return !norm.split(path.sep).some((p) => p === "..");
}

function resolvePathUnderWorkspace(workspaceDir: string, rel: string): string | null {
  if (!isSafeRelativeWorkspacePath(rel)) {
    return null;
  }
  const root = path.resolve(workspaceDir);
  const full = path.resolve(root, rel);
  const relToRoot = path.relative(root, full);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return null;
  }
  return full;
}

/**
 * Resolve mandatory Agent rules from workspace policy (inline or file under workspace).
 * Invalid paths or missing files fall back to inline `agentMandatoryRules` only.
 */
export function resolveAgentMandatoryRulesForPrompt(
  workspaceDir: string,
  policy: LawMindWorkspacePolicy | null,
): ResolvedAgentMandatoryRules {
  if (!policy) {
    return { active: false, truncated: false, text: "" };
  }

  const pathRel =
    typeof policy.agentMandatoryRulesPath === "string" ? policy.agentMandatoryRulesPath.trim() : "";
  const inline =
    typeof policy.agentMandatoryRules === "string" ? policy.agentMandatoryRules.trim() : "";

  let raw = "";

  if (pathRel) {
    const abs = resolvePathUnderWorkspace(workspaceDir, pathRel);
    if (abs && fs.existsSync(abs)) {
      try {
        const st = fs.statSync(abs);
        if (st.isFile()) {
          raw = fs.readFileSync(abs, "utf8").trim();
        }
      } catch {
        raw = "";
      }
    }
    if (!raw && inline) {
      raw = inline;
    }
  } else {
    raw = inline;
  }

  if (!raw) {
    return { active: false, truncated: false, text: "" };
  }

  let truncated = false;
  if (raw.length > AGENT_MANDATORY_RULES_MAX_CHARS) {
    truncated = true;
    raw = raw.slice(0, AGENT_MANDATORY_RULES_MAX_CHARS);
  }

  return { active: true, truncated, text: raw };
}

function parsePolicy(raw: string): LawMindWorkspacePolicy | null {
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object") {
      return null;
    }
    const o = j as Record<string, unknown>;
    if (typeof o.schemaVersion !== "number" || o.schemaVersion < 1) {
      return null;
    }
    return j as LawMindWorkspacePolicy;
  } catch {
    return null;
  }
}

/**
 * Read `lawmind.policy.json` from the workspace root (no env mutation).
 * Returns `null` if missing or invalid.
 */
export function readWorkspacePolicyFile(workspaceDir: string): LawMindWorkspacePolicy | null {
  const abs = path.join(path.resolve(workspaceDir), POLICY_FILENAME);
  if (!fs.existsSync(abs)) {
    return null;
  }
  const raw = fs.readFileSync(abs, "utf8");
  return parsePolicy(raw);
}

export function workspacePolicyPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), POLICY_FILENAME);
}

const MAX_TOOL_CALLS_CAP = 50;

/**
 * Effective max tool iterations per Agent turn: `lawmind.policy.json` overrides env when set.
 */
export function resolveAgentMaxToolCallsPerTurn(workspaceDir: string): number {
  const policy = readWorkspacePolicyFile(workspaceDir);
  const fromPolicy =
    policy &&
    typeof policy.agentMaxToolCallsPerTurn === "number" &&
    Number.isFinite(policy.agentMaxToolCallsPerTurn) &&
    policy.agentMaxToolCallsPerTurn > 0
      ? Math.floor(policy.agentMaxToolCallsPerTurn)
      : undefined;
  const envRaw = process.env.LAWMIND_AGENT_MAX_TOOL_CALLS?.trim();
  const envParsed = envRaw ? Math.floor(Number(envRaw)) : NaN;
  const fromEnv = Number.isFinite(envParsed) && envParsed > 0 ? envParsed : 15;
  const base = fromPolicy !== undefined ? fromPolicy : fromEnv;
  return Math.min(MAX_TOOL_CALLS_CAP, Math.max(1, base));
}
