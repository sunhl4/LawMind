/**
 * Honest authority tier for retrieval + draft verify.
 * Workspace heuristic tools are always `sample`. Live requires a configured
 * non-open provider (法宝/generic endpoint). Open sample/corpus is not live.
 */

import { buildAuthorityCorpusSummary } from "./authority-health.js";

export type AuthoritySourceTier = "sample" | "corpus" | "live";

export function resolveAuthoritySourceTier(opts?: {
  endpoint?: string;
  apiKey?: string;
  provider?: string;
}): AuthoritySourceTier {
  const summary = buildAuthorityCorpusSummary(opts);
  if (summary.status === "configured" && summary.provider !== "open") {
    return "live";
  }
  if (summary.status === "configured") {
    return "corpus";
  }
  return "sample";
}

export function isAuthorityLive(opts?: {
  endpoint?: string;
  apiKey?: string;
  provider?: string;
}): boolean {
  return resolveAuthoritySourceTier(opts) === "live";
}

/** search_statute / search_case_law only scan workspace memory. */
export const WORKSPACE_HEURISTIC_SOURCE_TIER: AuthoritySourceTier = "sample";
