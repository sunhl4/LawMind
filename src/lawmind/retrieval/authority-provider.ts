/**
 * Authority vendor selection.
 *
 * LAWMIND_AUTHORITY_PROVIDER accepts ONE id (legacy) or a comma-separated
 * list for multi-vendor fan-out（例：`yuandian,pkulaw`，元典 + 北大法宝同用）：
 *   open     — OSS：本地开放语料（+ 可选 NPC FLK）
 *   generic  — 通用 HTTP GET ?q=
 *   pkulaw   — 北大法宝 BYOK（LAWMIND_AUTHORITY_ENDPOINT / LAWMIND_AUTHORITY_API_KEY）
 *   yuandian — 元典开放平台（默认端点 open.chineselaw.com/mcp，独立 Key）
 *   lexis    — 闭源占位（需手动凭证）
 *
 * Default: open（开源默认可检索 sample；无编造）
 */

export type AuthorityProviderId = "open" | "generic" | "pkulaw" | "yuandian" | "lexis";

/** 元典开放平台 Streamable HTTP MCP endpoint (documented default). */
export const YUANDIAN_DEFAULT_ENDPOINT = "https://open.chineselaw.com/mcp";

export function resolveAuthorityProvider(opts?: { provider?: string }): AuthorityProviderId {
  const raw = (opts?.provider ?? process.env.LAWMIND_AUTHORITY_PROVIDER ?? "open")
    .trim()
    .toLowerCase();
  if (raw === "generic" || raw === "http" || raw === "rest") {
    return "generic";
  }
  if (raw === "pkulaw" || raw === "pku" || raw === "法宝" || raw === "北大法宝") {
    return "pkulaw";
  }
  if (raw === "yuandian" || raw === "元典" || raw === "元典智库") {
    return "yuandian";
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

/**
 * Parse the provider env into a unique ordered list.
 * Unknown tokens are dropped (caller surfaces a riskFlag, fail-closed to open).
 * Empty / unset → ["open"].
 */
export function resolveAuthorityProviderList(opts?: { provider?: string }): AuthorityProviderId[] {
  const raw = (opts?.provider ?? process.env.LAWMIND_AUTHORITY_PROVIDER ?? "").trim();
  if (!raw) {
    return ["open"];
  }
  const tokens = raw
    .split(/[,;、/\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const list: AuthorityProviderId[] = [];
  for (const token of tokens) {
    if (authorityProviderUnrecognized({ provider: token })) {
      continue; // unknown → caller warns; never silently promote to open
    }
    const id = resolveAuthorityProvider({ provider: token });
    if (!list.includes(id)) {
      list.push(id);
    }
  }
  return list.length > 0 ? list : ["open"];
}

/** Tokens that cannot be mapped to any provider (for fail-loud riskFlags). */
export function unknownAuthorityProviderTokens(opts?: { provider?: string }): string[] {
  const raw = (
    opts?.provider ??
    (opts ? undefined : process.env.LAWMIND_AUTHORITY_PROVIDER) ??
    ""
  ).trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(/[,;、/\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((token) => authorityProviderUnrecognized({ provider: token }));
}

const KNOWN_AUTHORITY_PROVIDER_TOKENS = new Set([
  "open",
  "opensource",
  "open-law",
  "npc",
  "flk",
  "generic",
  "http",
  "rest",
  "pkulaw",
  "pku",
  "法宝",
  "北大法宝",
  "yuandian",
  "元典",
  "元典智库",
  "lexis",
  "lexisnexis",
]);

/**
 * Non-empty provider token that is not a known alias.
 * Empty / unset stays the open default and is not a misconfiguration.
 */
export function authorityProviderUnrecognized(opts?: { provider?: string }): boolean {
  const raw = (opts?.provider ?? process.env.LAWMIND_AUTHORITY_PROVIDER ?? "").trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return !KNOWN_AUTHORITY_PROVIDER_TOKENS.has(raw);
}

export function authorityProviderLabel(id: AuthorityProviderId): string {
  switch (id) {
    case "open":
      return "开源语料（本地/NPC）";
    case "pkulaw":
      return "北大法宝";
    case "yuandian":
      return "元典智库";
    case "lexis":
      return "LexisNexis（闭源·手动）";
    case "generic":
      return "通用 HTTP（?q=）";
    default:
      return "开源语料（本地/NPC）";
  }
}

/** Providers with a built-in default endpoint (no LAWMIND_AUTHORITY_ENDPOINT needed). */
export function authorityProviderDefaultEndpoint(id: AuthorityProviderId): string | undefined {
  if (id === "open") {
    return undefined;
  }
  if (id === "yuandian") {
    return YUANDIAN_DEFAULT_ENDPOINT;
  }
  return undefined;
}

/** True when provider can serve without LAWMIND_AUTHORITY_ENDPOINT. */
export function authorityProviderNeedsEndpoint(id: AuthorityProviderId): boolean {
  // yuandian has a default endpoint but still requires its own API key.
  return id === "generic" || id === "pkulaw" || id === "lexis";
}
