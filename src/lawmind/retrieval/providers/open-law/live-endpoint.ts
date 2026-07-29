/**
 * URL safety for open-law live adapters (NPC / caseopen).
 * Reuses commercial SSRF guards; optionally allows loopback for self-hosted caseopen.
 */

import {
  assertAuthorityEndpointSafeToFetch,
  validateAuthorityEndpointUrl,
  type AuthorityEndpointValidation,
} from "../../authority-health.js";
import {
  denyReasonForAuthorityHostname,
  type AuthorityDnsLookupFn,
} from "../../authority-url-guard.js";

function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}

/**
 * Sync URL validation for open-law live endpoints.
 * When allowLoopback, 127.0.0.1 / localhost are accepted (cncases default).
 * Still rejects credentials-in-URL and non-http(s).
 */
export function validateOpenLawLiveEndpointUrl(
  raw: string,
  opts?: { allowLoopback?: boolean },
): AuthorityEndpointValidation {
  if (!opts?.allowLoopback) {
    return validateAuthorityEndpointUrl(raw);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "权威端点为空" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: "权威端点不是合法 URL（需 http:// 或 https://）" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: `权威端点协议必须是 http/https，当前为 ${url.protocol}` };
  }
  if (!url.hostname) {
    return { ok: false, message: "权威端点缺少主机名" };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      message: "权威端点请勿把密钥写在 URL 中；使用独立鉴权头/环境变量",
    };
  }
  if (!isLoopbackHostname(url.hostname)) {
    const hostDeny = denyReasonForAuthorityHostname(url.hostname);
    if (hostDeny) {
      return { ok: false, message: hostDeny };
    }
  }
  const normalized = trimmed.replace(/\/+$/, "");
  return { ok: true, url, normalized };
}

/**
 * Validate + optionally allow loopback (for self-hosted cncases on 127.0.0.1).
 * Commercial authority endpoints must NOT use allowLoopback.
 */
export async function assertOpenLawLiveEndpointSafe(
  raw: string,
  opts?: {
    allowLoopback?: boolean;
    lookup?: AuthorityDnsLookupFn;
  },
): Promise<AuthorityEndpointValidation> {
  const v = validateOpenLawLiveEndpointUrl(raw, { allowLoopback: opts?.allowLoopback });
  if (!v.ok) {
    return v;
  }
  if (opts?.allowLoopback && isLoopbackHostname(v.url.hostname)) {
    // Skip DNS/private deny for explicit opt-in self-hosted open-law endpoints.
    return v;
  }
  return assertAuthorityEndpointSafeToFetch(raw, { lookup: opts?.lookup });
}
