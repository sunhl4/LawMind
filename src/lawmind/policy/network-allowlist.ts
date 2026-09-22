/**
 * Outbound network allowlist (cLawyer-style) for web search tools.
 */

import type { LawMindEdition, LawMindWorkspacePolicy } from "./workspace-policy.js";

export type NetworkAllowlistCheck = {
  allowed: boolean;
  reason?: string;
};

/**
 * Recommended hosts for Firm / legal research (does not force enable web search).
 * One-click merge via Doctor / Settings → does not set networkAllowlistEnforced.
 */
export const RECOMMENDED_LEGAL_NETWORK_ALLOWLIST = [
  "api.search.brave.com",
  "npc.gov.cn",
  "www.gov.cn",
  "court.gov.cn",
  "supremecourt.gov.cn",
  "spp.gov.cn",
  "moj.gov.cn",
  "samr.gov.cn",
  "pkulaw.com",
  "www.pkulaw.com",
  "apim-gateway.pkulaw.com",
  "mcp.pkulaw.com",
  "chinalawinfo.com",
] as const;

/** Merge recommended legal hosts into an existing allowlist (dedupe, preserve order). */
export function mergeRecommendedLegalNetworkAllowlist(
  existing: string[] | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of [...(existing ?? []), ...RECOMMENDED_LEGAL_NETWORK_ALLOWLIST]) {
    const n = h.trim().toLowerCase();
    if (!n || seen.has(n)) {
      continue;
    }
    seen.add(n);
    out.push(n);
  }
  return out;
}

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

function hostMatchesAllowlist(host: string, entry: string): boolean {
  const h = normalizeHost(host);
  const e = entry.trim().toLowerCase();
  if (!e) {
    return false;
  }
  if (e.startsWith("*.")) {
    const suffix = e.slice(2);
    return h === suffix || h.endsWith(`.${suffix}`);
  }
  return h === e || h.endsWith(`.${e}`);
}

export function hostnameFromUrl(url: string): string | null {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * Returns whether outbound fetch to `hostname` is permitted under policy + edition.
 */
export function checkNetworkAllowlist(opts: {
  policy: LawMindWorkspacePolicy | null;
  edition: LawMindEdition;
  hostname: string;
}): NetworkAllowlistCheck {
  const host = normalizeHost(opts.hostname);
  const policy = opts.policy;
  const list = Array.isArray(policy?.networkAllowlist)
    ? policy.networkAllowlist.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const enforced =
    policy?.networkAllowlistEnforced === true ||
    opts.edition === "firm" ||
    opts.edition === "private_deploy";

  if (list.length > 0) {
    const ok = list.some((entry) => hostMatchesAllowlist(host, entry));
    if (!ok) {
      return {
        allowed: false,
        reason: `主机「${host}」不在 lawmind.policy.json 的 networkAllowlist 中。`,
      };
    }
    return { allowed: true };
  }

  if (enforced) {
    return {
      allowed: false,
      reason:
        "Firm/严格模式下须在工作区策略中配置 networkAllowlist（例如 api.search.brave.com）后才可联网检索。",
    };
  }

  return { allowed: true };
}
