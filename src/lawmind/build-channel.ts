/**
 * Build flavor isolation (C5 / G10).
 *
 * LAWMIND_BUILD_CHANNEL=oss|commercial
 * Default: oss — commercial BFF / platform proxy must not activate.
 */

export type LawmindBuildChannel = "oss" | "commercial";

export function getBuildChannel(opts?: { channel?: string }): LawmindBuildChannel {
  const raw = (opts?.channel ?? process.env.LAWMIND_BUILD_CHANNEL ?? "oss").trim().toLowerCase();
  return raw === "commercial" ? "commercial" : "oss";
}

export function isCommercialBuild(opts?: { channel?: string }): boolean {
  return getBuildChannel(opts) === "commercial";
}

/** Platform authority proxy (BFF) only when commercial + env allows. */
export function isPlatformAuthorityProxyEnabled(opts?: {
  channel?: string;
  enableProxy?: string;
}): boolean {
  if (!isCommercialBuild(opts)) {
    return false;
  }
  const flag = (opts?.enableProxy ?? process.env.LAWMIND_PLATFORM_AUTHORITY_PROXY ?? "")
    .trim()
    .toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}
