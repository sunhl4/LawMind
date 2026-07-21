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
  /**
   * W10：是否采集产品级洞察事件（ux.matter_action）。
   *   - "off"：完全不写新 kind；现有 ui.matter_action 仍写。
   *   - "local-only"（默认）：双写 ux.matter_action，仅本地存储。
   *   - "synced"：双写并允许后续上传 / 跨案件聚合（当前语义与 local-only 一致，季末再决定）。
   * Solo edition 默认 "local-only"。
   */
  productInsightsCollection?: "off" | "local-only" | "synced";
  /**
   * Allowed outbound hostnames for web search / statute search (cLawyer-style).
   * Empty or omitted = no extra restriction beyond edition defaults.
   */
  networkAllowlist?: string[];
  /** When true, web search tools require a non-empty networkAllowlist in firm/strict modes. */
  networkAllowlistEnforced?: boolean;
  /** Context window / auto-compact tuning (Claude Code–style defaults). */
  context?: {
    autoCompactBufferTokens?: number;
    maxConsecutiveCompactFailures?: number;
    summaryOutputTokenReserve?: number;
  };
  /** High-security desktop preset: disable web + auto memory adopt hints. */
  highSecurityMode?: boolean;
  /**
   * P2：高风险工具在子进程内执行（POC）。也可用 `LAWMIND_TOOL_SANDBOX=1`。
   * 默认关闭。
   */
  toolSandbox?: boolean;
  /**
   * P2：律所团队记忆云同步（opt-in，默认关闭）。仅 `edition: firm` 且 `enabled: true` 时生效。
   */
  teamMemorySync?: {
    enabled?: boolean;
    endpoint?: string;
  };
  /** Memory recall tuning (Claude Code–style small-file preference). */
  memoryRecall?: {
    /** Boost manifest entries under `smallFileMaxBytes` when ranking. */
    preferSmallFiles?: boolean;
    smallFileMaxBytes?: number;
  };
  /**
   * Skills E4：引用模式。
   * - grounded：无源/未锚定长段阻断 strict 导出
   * - assisted（Solo 默认）：缺源阻断导出，未锚定仅提示
   * - off：不因引用阻断
   * 也可用环境变量 `LAWMIND_CITATION_MODE`。
   */
  citationMode?: "grounded" | "assisted" | "off";
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

/** Merge patch into `lawmind.policy.json` (creates file with schemaVersion 1 if missing). */
export function mergeWorkspacePolicyFile(
  workspaceDir: string,
  patch: Partial<LawMindWorkspacePolicy>,
): { ok: true; policy: LawMindWorkspacePolicy } | { ok: false; error: string } {
  const abs = workspacePolicyPath(workspaceDir);
  const existing = readWorkspacePolicyFile(workspaceDir) ?? { schemaVersion: 1 };
  const merged: LawMindWorkspacePolicy = {
    ...existing,
    ...patch,
    schemaVersion: existing.schemaVersion >= 1 ? existing.schemaVersion : 1,
  };
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    return { ok: true, policy: merged };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
