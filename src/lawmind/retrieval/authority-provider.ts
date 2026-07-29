/**
 * Authority vendor selection.
 *
 * LAWMIND_AUTHORITY_PROVIDER=
 *   open     — OSS：本地开放语料（+ 可选 NPC FLK）
 *   generic  — 通用 HTTP GET ?q=
 *   pkulaw   — 闭源占位 / BYOK 法宝（需手动凭证）
 *   lexis    — 闭源占位（需手动凭证）
 *
 * Default: open（开源默认可检索 sample；无编造）
 */

export type AuthorityProviderId = "open" | "generic" | "pkulaw" | "lexis";

export function resolveAuthorityProvider(opts?: { provider?: string }): AuthorityProviderId {
  const raw = (opts?.provider ?? process.env.LAWMIND_AUTHORITY_PROVIDER ?? "open")
    .trim()
    .toLowerCase();
  if (raw === "generic" || raw === "http" || raw === "rest") {
    return "generic";
  }
  if (raw === "pkulaw" || raw === "pku" || raw === "法宝") {
    return "pkulaw";
  }
  if (raw === "lexis" || raw === "lexisnexis") {
    return "lexis";
  }
  if (
    raw === "open" ||
    raw === "opensource" ||
    raw === "open-law" ||
    raw === "npc" ||
    raw === "flk"
  ) {
    return "open";
  }
  // Unknown → open (fail-closed local corpus) rather than commercial
  return "open";
}

export function authorityProviderLabel(id: AuthorityProviderId): string {
  switch (id) {
    case "open":
      return "开源语料（本地/NPC）";
    case "pkulaw":
      return "北大法宝（闭源·手动）";
    case "lexis":
      return "LexisNexis（闭源·手动）";
    case "generic":
      return "通用 HTTP（?q=）";
    default:
      return "开源语料（本地/NPC）";
  }
}

/** True when provider can serve without LAWMIND_AUTHORITY_ENDPOINT. */
export function authorityProviderNeedsEndpoint(id: AuthorityProviderId): boolean {
  return id === "generic" || id === "pkulaw" || id === "lexis";
}
