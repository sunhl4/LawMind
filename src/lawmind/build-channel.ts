/**
 * Build flavor isolation (C5 / G10).
 *
 * LAWMIND_BUILD_CHANNEL=oss|commercial is read once, when this module loads
 * (process start). That is the packager/CI stamp. A later env write, or
 * `lawmind.policy.json`, cannot move an oss process onto the commercial proxy.
 * Unknown values and Edition ids (`firm`, `private_deploy`) fail closed to oss.
 *
 * Default: oss — commercial BFF / platform proxy must not activate.
 */

export type LawmindBuildChannel = "oss" | "commercial";

export function normalizeBuildChannel(raw: string | undefined): LawmindBuildChannel {
  return raw?.trim().toLowerCase() === "commercial" ? "commercial" : "oss";
}

/** Frozen at import. Tests pass `opts.channel` to avoid depending on this stamp. */
const stampedBuildChannel = normalizeBuildChannel(process.env.LAWMIND_BUILD_CHANNEL);

export function getBuildChannel(opts?: { channel?: string }): LawmindBuildChannel {
  if (opts && Object.prototype.hasOwnProperty.call(opts, "channel")) {
    return normalizeBuildChannel(opts.channel);
  }
  return stampedBuildChannel;
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
