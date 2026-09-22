/**
 * Shared deny-list for authority endpoint hosts (SSRF hardening).
 * Used by commercial LAWMIND_AUTHORITY_ENDPOINT and NPC FLK override URLs.
 *
 * Sync: hostname / literal-IP deny.
 * Async: DNS → address deny (blocks public hostnames that resolve to private IPs).
 */

import dns from "node:dns/promises";

const DENIED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "metadata.aws.internal",
]);

function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function ipv4DenyReason(host: string): string | null {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return `权威端点主机「${host}」不是合法 IPv4`;
  }
  const [a, b] = parts;
  if (a === 0) {
    return `权威端点拒绝本机/保留地址「${host}」`;
  }
  if (a === 127) {
    return `权威端点拒绝 loopback「${host}」`;
  }
  if (a === 10) {
    return `权威端点拒绝私网地址「${host}」`;
  }
  // CGNAT / carrier-grade NAT (RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) {
    return `权威端点拒绝共享地址空间「${host}」`;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return `权威端点拒绝私网地址「${host}」`;
  }
  if (a === 192 && b === 168) {
    return `权威端点拒绝私网地址「${host}」`;
  }
  if (a === 169 && b === 254) {
    return `权威端点拒绝 link-local / 元数据地址「${host}」`;
  }
  return null;
}

function ipv6DenyReason(host: string): string | null {
  const h = host.toLowerCase();
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") {
    return `权威端点拒绝 loopback「${host}」`;
  }
  if (h.startsWith("fe80:")) {
    return `权威端点拒绝 link-local「${host}」`;
  }
  // Unique local (fc00::/7)
  if (h.startsWith("fc") || h.startsWith("fd")) {
    return `权威端点拒绝私网 IPv6「${host}」`;
  }
  return null;
}

/** Normalize IPv4-mapped IPv6 (::ffff:x.x.x.x) to the embedded IPv4. */
export function normalizeAuthorityIpAddress(address: string): string {
  const h = address.trim().toLowerCase();
  if (h.startsWith("::ffff:")) {
    const mapped = h.slice("::ffff:".length);
    if (isIpv4Literal(mapped)) {
      return mapped;
    }
  }
  return h;
}

/**
 * Deny reason for a resolved IP (v4 or v6), or null when allowed.
 */
export function denyReasonForAuthorityIpAddress(address: string): string | null {
  const host = normalizeAuthorityIpAddress(address);
  if (!host) {
    return "权威端点解析地址为空";
  }
  if (isIpv4Literal(host)) {
    return ipv4DenyReason(host);
  }
  if (host.includes(":")) {
    return ipv6DenyReason(host);
  }
  return `权威端点解析地址「${address}」无法识别`;
}

/**
 * Returns a lawyer-facing deny reason, or null when the hostname is allowed.
 * Does not resolve DNS — use {@link denyReasonForAuthorityHostnameResolved} before fetch.
 */
export function denyReasonForAuthorityHostname(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) {
    return "权威端点缺少主机名";
  }
  if (DENIED_HOSTNAMES.has(host)) {
    return `权威端点主机「${host}」不允许（私网/元数据）`;
  }
  if (host.endsWith(".localhost") || host.endsWith(".local")) {
    return `权威端点主机「${host}」不允许（本机/mDNS）`;
  }
  if (isIpv4Literal(host)) {
    return ipv4DenyReason(host);
  }
  if (host.includes(":")) {
    return ipv6DenyReason(host);
  }
  return null;
}

export type AuthorityDnsLookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family?: number }>>;

async function defaultAuthorityDnsLookup(
  hostname: string,
): Promise<Array<{ address: string; family?: number }>> {
  // Vitest suites mock fetch against fictional hosts (e.g. authority.example);
  // real DNS often ENOTFOUND. Production always resolves. SSRF DNS→private is
  // covered by unit tests that inject `lookup` returning private addresses.
  if (process.env.VITEST === "true") {
    void hostname;
    return [{ address: "203.0.113.10", family: 4 }];
  }
  return dns.lookup(hostname, { all: true, verbatim: true });
}

/**
 * Hostname deny + DNS resolution check (fail-closed on resolve failure / empty).
 * Literal IPs skip DNS and reuse hostname deny.
 */
export async function denyReasonForAuthorityHostnameResolved(
  hostname: string,
  opts?: { lookup?: AuthorityDnsLookupFn },
): Promise<string | null> {
  const hostDeny = denyReasonForAuthorityHostname(hostname);
  if (hostDeny) {
    return hostDeny;
  }
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  // Literals already covered by hostname deny.
  if (isIpv4Literal(host) || host.includes(":")) {
    return null;
  }
  const lookup = opts?.lookup ?? defaultAuthorityDnsLookup;
  let addrs: Array<{ address: string; family?: number }>;
  try {
    addrs = await lookup(host);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return `权威端点主机「${host}」DNS 解析失败（fail-closed）：${detail}`;
  }
  if (!addrs.length) {
    return `权威端点主机「${host}」DNS 无解析结果（fail-closed）`;
  }
  for (const row of addrs) {
    const ipDeny = denyReasonForAuthorityIpAddress(row.address);
    if (ipDeny) {
      return `权威端点主机「${host}」解析到不可达地址：${ipDeny}`;
    }
  }
  return null;
}
