/**
 * Authority corpus endpoint contract (R-P0-4 trust ceiling).
 *
 * Sync validation for Doctor/health; optional HTTP probe when wiring a real
 * vendor (北大法宝 / Lexis / self-hosted) via LAWMIND_AUTHORITY_ENDPOINT.
 * Does not fabricate a public legal corpus — unset / invalid → fail-closed.
 */

import {
  authorityProviderLabel,
  authorityProviderNeedsEndpoint,
  resolveAuthorityProvider,
} from "./authority-provider.js";
import {
  denyReasonForAuthorityHostname,
  denyReasonForAuthorityHostnameResolved,
  type AuthorityDnsLookupFn,
} from "./authority-url-guard.js";
import { openLawCorpusStats } from "./providers/open-law/local-corpus.js";
import { summarizeOpenLawSources } from "./providers/open-law/sources.js";
import type { OpenLawSourceStatus } from "./providers/open-law/sources.js";

export type AuthorityCorpusConfigStatus =
  | "unset"
  | "invalid"
  | "configured"
  /** Open-law bundled sample only (demo; not a commercial corpus). */
  | "sample-ready"
  /** Provider selected but adapter not implemented (e.g. Lexis placeholder). */
  | "unimplemented";

export type AuthorityCorpusSummary = {
  /**
   * True when authority path is usable for probe/UI enablement.
   * For open: sample or external corpus loaded. For HTTP providers: valid endpoint.
   */
  configured: boolean;
  status: AuthorityCorpusConfigStatus;
  /** Host (or masked origin) for UI — never includes secrets. */
  endpointHost: string | null;
  /** True when LAWMIND_AUTHORITY_API_KEY is set (value never exposed). */
  authConfigured: boolean;
  /** Resolved provider: open | generic | pkulaw | lexis */
  provider: "open" | "generic" | "pkulaw" | "lexis";
  /** Lawyer-facing provider label */
  providerLabel: string;
  /** Lawyer-facing Chinese status line. */
  message: string;
  /** Env contract name (documentation / Doctor). */
  envKey: "LAWMIND_AUTHORITY_ENDPOINT";
  /** Optional bearer key env (documentation / Doctor). */
  authEnvKey: "LAWMIND_AUTHORITY_API_KEY";
  providerEnvKey: "LAWMIND_AUTHORITY_PROVIDER";
  /** Open-law only: which open sources are configured/ready (sync). */
  openSources?: OpenLawSourceStatus[];
};

/** Ready for Doctor probe / settings actions (sample-ready or commercial configured). */
export function isAuthorityCorpusReady(
  status: AuthorityCorpusConfigStatus | string | undefined | null,
): boolean {
  return status === "configured" || status === "sample-ready";
}

export type AuthorityEndpointValidation =
  | { ok: true; url: URL; normalized: string }
  | { ok: false; message: string };

export type AuthorityProbeResult = {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  hitCount?: number;
  error?: string;
};

const ENV_KEY = "LAWMIND_AUTHORITY_ENDPOINT" as const;
const AUTH_ENV_KEY = "LAWMIND_AUTHORITY_API_KEY" as const;
const PROVIDER_ENV_KEY = "LAWMIND_AUTHORITY_PROVIDER" as const;

/** Read raw endpoint from opts or process.env (trimmed). */
export function resolveAuthorityEndpointRaw(opts?: { endpoint?: string }): string {
  const fromOpts = opts?.endpoint?.trim() ?? "";
  if (fromOpts) {
    return fromOpts;
  }
  return process.env.LAWMIND_AUTHORITY_ENDPOINT?.trim() || "";
}

/** Optional bearer token for vendor APIs — never log or return the value. */
export function resolveAuthorityApiKey(opts?: { apiKey?: string }): string {
  const fromOpts = opts?.apiKey?.trim() ?? "";
  if (fromOpts) {
    return fromOpts;
  }
  return process.env.LAWMIND_AUTHORITY_API_KEY?.trim() || "";
}

/** Headers for authority GET (Accept + optional Bearer). */
export function buildAuthorityRequestHeaders(opts?: { apiKey?: string }): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  const key = resolveAuthorityApiKey(opts);
  if (key) {
    headers.authorization = `Bearer ${key}`;
  }
  return headers;
}

/**
 * Fail-closed URL validation: http(s) only, non-empty host, no credentials in URL,
 * and no private / link-local / cloud-metadata hosts (SSRF deny — shared with NPC override).
 * Query string on the base endpoint is allowed (vendor paths); we append `q` at retrieve.
 */
export function validateAuthorityEndpointUrl(raw: string): AuthorityEndpointValidation {
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
  const hostDeny = denyReasonForAuthorityHostname(url.hostname);
  if (hostDeny) {
    return { ok: false, message: hostDeny };
  }
  // Strip trailing slash for stable join with ?q=
  const normalized = trimmed.replace(/\/+$/, "");
  return { ok: true, url, normalized };
}

/**
 * Sync URL validation + async DNS→private deny before any authority/NPC fetch.
 * Fail-closed when DNS fails or resolves to private / link-local / metadata.
 */
export async function assertAuthorityEndpointSafeToFetch(
  raw: string,
  opts?: { lookup?: AuthorityDnsLookupFn },
): Promise<AuthorityEndpointValidation> {
  const v = validateAuthorityEndpointUrl(raw);
  if (!v.ok) {
    return v;
  }
  const dnsDeny = await denyReasonForAuthorityHostnameResolved(v.url.hostname, {
    lookup: opts?.lookup,
  });
  if (dnsDeny) {
    return { ok: false, message: dnsDeny };
  }
  return v;
}

/** Sync Doctor/health summary — no network I/O. */
export function buildAuthorityCorpusSummary(opts?: {
  endpoint?: string;
  apiKey?: string;
  provider?: string;
}): AuthorityCorpusSummary {
  const raw = resolveAuthorityEndpointRaw(opts);
  const authConfigured = Boolean(resolveAuthorityApiKey(opts));
  const provider = resolveAuthorityProvider({ provider: opts?.provider });
  const providerLabel = authorityProviderLabel(provider);

  // OSS open-law: ready when local corpus loads (no commercial endpoint required).
  if (provider === "open") {
    const stats = openLawCorpusStats();
    const openSummary = summarizeOpenLawSources();
    const ok = stats.recordCount > 0;
    const status: AuthorityCorpusConfigStatus = !ok
      ? "unset"
      : stats.externalCorpus
        ? "configured"
        : "sample-ready";
    const liveReady = openSummary.readyIds.filter((id) => id === "npc_flk" || id === "caseopen");
    const liveNote =
      liveReady.length > 0 ? ` 已启用直播：${liveReady.join("+")}。` : "";
    return {
      configured: ok,
      status,
      endpointHost: stats.externalCorpus ? "local-corpus+external" : "local-corpus",
      authConfigured: false,
      provider,
      providerLabel,
      message: ok
        ? stats.externalCorpus
          ? `开源权威已就绪：本地语料 ${stats.recordCount} 条（含外部 CORPUS；许可由你自行确认）。${openSummary.message}.${liveNote}闭源法宝/Lexis 另见手动接入。`
          : `演示语料就绪：内置 sample ${stats.recordCount} 条（非正式完整法库；许可仅供演示检索，正式引用请核对官方法条）。可选 LAWMIND_OPEN_LAW_CORPUS 扩充；LAWMIND_OPEN_LAW_NPC=1 / LAWMIND_OPEN_LAW_CASEOPEN=1 启用直播。${liveNote}`
        : "开源语料未加载：请检查内置 sample 或 LAWMIND_OPEN_LAW_CORPUS。",
      envKey: ENV_KEY,
      authEnvKey: AUTH_ENV_KEY,
      providerEnvKey: PROVIDER_ENV_KEY,
      openSources: openSummary.sources,
    };
  }

  if (!authorityProviderNeedsEndpoint(provider)) {
    return {
      configured: false,
      status: "unset",
      endpointHost: null,
      authConfigured,
      provider,
      providerLabel,
      message: `provider=${provider} 未配置。`,
      envKey: ENV_KEY,
      authEnvKey: AUTH_ENV_KEY,
      providerEnvKey: PROVIDER_ENV_KEY,
    };
  }

  if (!raw) {
    return {
      configured: false,
      status: "unset",
      endpointHost: null,
      authConfigured,
      provider,
      providerLabel,
      message:
        provider === "pkulaw" || provider === "lexis"
          ? `闭源 provider=${provider}：请配置 LAWMIND_AUTHORITY_ENDPOINT 与 API Key（手动接入）；或改回 LAWMIND_AUTHORITY_PROVIDER=open 使用开源语料。`
          : "未配置 LAWMIND_AUTHORITY_ENDPOINT：请配置通用端点，或使用 LAWMIND_AUTHORITY_PROVIDER=open。",
      envKey: ENV_KEY,
      authEnvKey: AUTH_ENV_KEY,
      providerEnvKey: PROVIDER_ENV_KEY,
    };
  }
  const v = validateAuthorityEndpointUrl(raw);
  if (!v.ok) {
    return {
      configured: false,
      status: "invalid",
      endpointHost: null,
      authConfigured,
      provider,
      providerLabel,
      message: `权威端点配置无效（fail-closed）：${v.message}`,
      envKey: ENV_KEY,
      authEnvKey: AUTH_ENV_KEY,
      providerEnvKey: PROVIDER_ENV_KEY,
    };
  }
  const authNote = authConfigured
    ? "已配置 LAWMIND_AUTHORITY_API_KEY（Bearer）。"
    : "未配置 LAWMIND_AUTHORITY_API_KEY（公开端点或不需要鉴权时可省略）。";
  // Lexis: endpoint may be set for BYOK prep, but adapter is still a placeholder —
  // use dedicated "unimplemented" (not "invalid") so Doctor pills do not imply a bad URL.
  if (provider === "lexis") {
    return {
      configured: false,
      status: "unimplemented",
      endpointHost: v.url.host,
      authConfigured,
      provider,
      providerLabel,
      message: `provider=lexis 适配器尚未实现（闭源占位）：端点 ${v.url.host} 已记录但探测/检索不会对假端点报绿。请改用 open/generic/pkulaw，或完成联调后补真实客户端。${authNote}`,
      envKey: ENV_KEY,
      authEnvKey: AUTH_ENV_KEY,
      providerEnvKey: PROVIDER_ENV_KEY,
    };
  }
  const providerNote =
    provider === "pkulaw"
      ? "provider=pkulaw（闭源·需厂商 Token）。"
      : `provider=${provider}（${providerLabel}）。`;
  return {
    configured: true,
    status: "configured",
    endpointHost: v.url.host,
    authConfigured,
    provider,
    providerLabel,
    message: `已配置权威检索端点（${v.url.host}）。${providerNote}${authNote}失败仍拒答、不编造。`,
    envKey: ENV_KEY,
    authEnvKey: AUTH_ENV_KEY,
    providerEnvKey: PROVIDER_ENV_KEY,
  };
}

/**
 * Lightweight GET health probe: `{endpoint}?q=__lawmind_health__`.
 * Expects JSON with hits/items array (may be empty). Non-OK HTTP → not ok.
 */
export async function probeAuthorityEndpoint(opts: {
  endpoint: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  lookup?: AuthorityDnsLookupFn;
}): Promise<AuthorityProbeResult> {
  const v = await assertAuthorityEndpointSafeToFetch(opts.endpoint, { lookup: opts.lookup });
  if (!v.ok) {
    return { ok: false, latencyMs: 0, error: v.message };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const url = `${v.normalized}?q=${encodeURIComponent("__lawmind_health__")}`;
  const started = Date.now();
  try {
    const res = await fetchImpl(url, {
      headers: buildAuthorityRequestHeaders({ apiKey: opts.apiKey }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        latencyMs,
        error: `权威健康检查 HTTP ${res.status}`,
      };
    }
    let hitCount = 0;
    try {
      const body = (await res.json()) as { hits?: unknown; items?: unknown };
      const rawHits = Array.isArray(body.hits)
        ? body.hits
        : Array.isArray(body.items)
          ? body.items
          : null;
      if (rawHits === null) {
        return {
          ok: false,
          httpStatus: res.status,
          latencyMs,
          error: "权威健康检查响应缺少 hits/items 数组",
        };
      }
      hitCount = rawHits.length;
    } catch {
      return {
        ok: false,
        httpStatus: res.status,
        latencyMs,
        error: "权威健康检查响应不是合法 JSON",
      };
    }
    return { ok: true, httpStatus: res.status, latencyMs, hitCount };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
