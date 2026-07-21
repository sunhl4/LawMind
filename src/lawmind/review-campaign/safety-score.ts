/**
 * Safety Score aggregator — Skills E2 / W24 lite (deterministic).
 */

import type { ReviewCampaignFinding, ReviewCampaignRoleResult, SafetyScore } from "./types.js";

function severityRank(s: ReviewCampaignFinding["severity"]): number {
  if (s === "high") {
    return 3;
  }
  if (s === "medium") {
    return 2;
  }
  return 1;
}

export function aggregateSafetyScore(roles: ReviewCampaignRoleResult[]): SafetyScore {
  const done = roles.filter((r) => r.status === "done");
  let weightSum = 0;
  let weighted = 0;
  for (const r of done) {
    const w = r.weight > 0 ? r.weight : 0.1;
    const s = typeof r.score === "number" ? r.score : 50;
    weightSum += w;
    weighted += w * s;
  }
  const score = weightSum > 0 ? Math.round(Math.min(100, Math.max(0, weighted / weightSum))) : 0;

  let high = 0;
  let medium = 0;
  let low = 0;
  const negotiateRaw: SafetyScore["negotiatePriority"] = [];
  for (const r of done) {
    for (const f of r.findings) {
      if (f.severity === "high") {
        high += 1;
      } else if (f.severity === "medium") {
        medium += 1;
      } else {
        low += 1;
      }
      negotiateRaw.push({
        roleId: r.roleId,
        title: f.title,
        severity: f.severity,
        priority: f.negotiatePriority ?? severityRank(f.severity),
      });
    }
  }
  negotiateRaw.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return severityRank(b.severity) - severityRank(a.severity);
  });
  const negotiatePriority = negotiateRaw.map((n, i) => ({ ...n, priority: i + 1 }));

  return {
    score,
    high,
    medium,
    low,
    negotiatePriority,
    computedAt: new Date().toISOString(),
  };
}
