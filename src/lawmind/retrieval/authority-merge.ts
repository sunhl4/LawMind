/**
 * Merge RetrievalResults from multiple authority providers (multi-vendor mode).
 *
 * Rules:
 * - Sources keep vendor tags (`source.provider`); cross-vendor duplicates are
 *   intentionally BOTH kept — agreement across independent databases is a
 *   stronger authority signal than either alone.
 * - In-vendor duplicates (same provider+title+citation+url) collapse; claims
 *   referencing collapsed ids are remapped onto the kept source, per part.
 * - When a raw vendor id is already used by an earlier source, later parts get
 *   fresh UUIDs and their own claims are remapped — claim.sourceIds must stay
 *   valid and point at their own vendor's source (no cross-vendor drift).
 * - riskFlags / missingItems: union in part order (lawyer-facing honesty wins).
 * - authorityOutcome: best status across parts by fixed priority; hitCount sums.
 */

import { randomUUID } from "node:crypto";
import type { AuthorityCallStatus, AuthorityCallOutcome } from "./authority-outcome.js";
import type { RetrievalResult } from "./index.js";

const STATUS_PRIORITY: AuthorityCallStatus[] = [
  "ok",
  "empty",
  "rate_limited",
  "quota_exhausted",
  "unauthorized",
  "invalid_response",
  "unavailable",
  "not_configured",
];

function betterStatus(a: AuthorityCallStatus, b: AuthorityCallStatus): AuthorityCallStatus {
  const ai = STATUS_PRIORITY.indexOf(a);
  const bi = STATUS_PRIORITY.indexOf(b);
  // 前一项是「更可用」的状态；多库合并取最优（有库成功就不把整轮说成失败）。
  return ai <= bi ? a : b;
}

/** Union with stable order. */
function dedupeLines(lines: string[]): string[] {
  return [...new Set(lines.map((l) => l.trim()).filter((l) => l.length > 0))];
}

export function mergeAuthorityOutcomes(
  outcomes: (AuthorityCallOutcome | undefined)[],
): AuthorityCallOutcome | undefined {
  const present = outcomes.filter((o): o is AuthorityCallOutcome => o != null);
  if (present.length === 0) {
    return undefined;
  }
  let status = present[0]?.status ?? "not_configured";
  let httpStatus: number | undefined = undefined;
  let hitCount = 0;
  for (const o of present) {
    status = betterStatus(status, o.status);
    httpStatus ??= o.httpStatus;
    hitCount += o.hitCount;
  }
  return { status, httpStatus, hitCount };
}

export function mergeRetrievalResults(parts: RetrievalResult[]): RetrievalResult {
  if (parts.length === 0) {
    return { sources: [], claims: [], riskFlags: [], missingItems: [] };
  }
  type KeptSource = NonNullable<RetrievalResult["sources"]>[number];
  const sources: KeptSource[] = [];
  const usedIds = new Set<string>();
  const perPartRemap: Map<string, string>[] = [];

  // Pass 1: unify sources, per-part id remaps.
  for (const part of parts) {
    const remap = new Map<string, string>();
    for (const src of part.sources) {
      const rawId = src.id ?? randomUUID();
      const key = `${src.provider ?? ""}|${src.title}|${src.citation ?? ""}|${src.url ?? ""}`;
      const dup = sources.find(
        (s) => `${s.provider ?? ""}|${s.title}|${s.citation ?? ""}|${s.url ?? ""}` === key,
      );
      if (dup?.id) {
        if (rawId !== dup.id) {
          remap.set(rawId, dup.id);
        }
        continue;
      }
      const keptId = usedIds.has(rawId) ? randomUUID() : rawId;
      usedIds.add(keptId);
      if (keptId !== rawId) {
        remap.set(rawId, keptId);
      }
      sources.push({ ...src, id: keptId });
    }
    perPartRemap.push(remap);
  }

  // Pass 2: remap claims with their own part's map; keep claims whose sources survive.
  const claims: Required<RetrievalResult>["claims"] = [];
  const seenClaims = new Set<string>();
  parts.forEach((part, i) => {
    for (const claim of part.claims) {
      const mapped = [
        ...new Set(claim.sourceIds.map((id) => perPartRemap[i]?.get(id) ?? id)),
      ].filter((id) => sources.some((s) => s.id === id));
      if (mapped.length === 0) {
        continue;
      }
      const claimKey = `${claim.text}|${mapped.join(",")}`;
      if (seenClaims.has(claimKey)) {
        continue;
      }
      seenClaims.add(claimKey);
      claims.push({ ...claim, sourceIds: mapped });
    }
  });

  const riskFlags = dedupeLines(parts.flatMap((p) => p.riskFlags));
  const missingItems = dedupeLines(parts.flatMap((p) => p.missingItems));
  const outcome = mergeAuthorityOutcomes(parts.map((p) => p.authorityOutcome));
  return {
    sources,
    claims,
    riskFlags,
    missingItems,
    ...(outcome ? { authorityOutcome: outcome } : {}),
  };
}
