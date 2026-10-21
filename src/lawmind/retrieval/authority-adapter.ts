/**
 * Authority retrieval adapter (P2-1 / R-P0-4 / Track B).
 *
 * Routes by LAWMIND_AUTHORITY_PROVIDER — now ONE id (legacy) or a
 * comma-separated list for multi-vendor fan-out（元典 + 北大法宝同用）：
 * - open (default): local open corpus (+ optional NPC / caseopen / CourtListener / EUR-Lex / e-Gov)
 * - generic: GET ?q= → hits/items
 * - pkulaw: commercial BYOK（LAWMIND_AUTHORITY_ENDPOINT / LAWMIND_AUTHORITY_API_KEY）
 * - yuandian: 元典开放平台（默认端点 open.chineselaw.com/mcp + LAWMIND_YUANDIAN_API_KEY）
 * - lexis: commercial placeholder（手动接入）
 *
 * Multi-vendor mode：并发检索各库 → 去重合并（跨库命中都保留）；未配置的库自动
 * 跳过；全部未配置则保持 fail-closed（不得编造法条）。单库路径行为与旧版一致。
 */

import type { TaskIntent } from "../types.js";
import {
  assertAuthorityEndpointSafeToFetch,
  buildAuthorityRequestHeaders,
  resolveAuthorityApiKey,
  resolveAuthorityEndpointRaw,
  validateAuthorityEndpointUrl,
} from "./authority-health.js";
import {
  authorityHttpErrorResult,
  invalidAuthorityEndpointResult,
  mapHitsToRetrievalResult,
  type AuthorityHit,
  unsetAuthorityResult,
} from "./authority-hits.js";
import { mergeRetrievalResults } from "./authority-merge.js";
import { authorityCallSucceeded, authorityHttpStatus } from "./authority-outcome.js";
import { createPinnedAuthorityFetch } from "./authority-pinned-fetch.js";
import {
  authorityProviderLabel,
  authorityProviderUnrecognized,
  resolveAuthorityProvider,
  resolveAuthorityProviderList,
  type AuthorityProviderId,
} from "./authority-provider.js";
import type { AuthorityDnsLookupFn } from "./authority-url-guard.js";
import { recordAuthorityUsage } from "./authority-usage.js";
import type { RetrievalAdapter, RetrievalResult } from "./index.js";
import { lexisAdapterMessage } from "./providers/lexis/placeholder.js";
import { openLawRetrieve } from "./providers/open-law/client.js";
import {
  pkulawRetrieve,
  resolvePkulawMode,
  type PkulawSearchKind,
} from "./providers/pkulaw/client.js";
import {
  resolveYuandianApiKey,
  resolveYuandianEndpoint,
  yuandianRetrieve,
} from "./providers/yuandian/client.js";

export type { AuthorityHit };

function needsAuthority(intent: TaskIntent): boolean {
  return (
    intent.kind === "research.legal" ||
    intent.kind === "research.hybrid" ||
    /(法条|法规|民法典|司法解释|判例|权威)/.test(intent.instruction ?? intent.summary ?? "")
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const h = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}

/**
 * Wrap fetch so that non-loopback open-law live endpoints (NPC / caseopen with
 * a custom non-local host) go through the connection-layer DNS pin, while
 * loopback self-hosted caseopen keeps using plain fetch (pinned fetch rejects
 * loopback by design). This closes the DNS-rebinding TOCTOU for non-loopback
 * open-law endpoints without breaking the local self-hosted use case.
 */
function createOpenLawPinnedFetch(
  plainFetch: typeof fetch,
  pinnedFetch: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    let hostname: string;
    if (typeof input === "string") {
      hostname = new URL(input).hostname;
    } else if (input instanceof URL) {
      hostname = input.hostname;
    } else {
      hostname = new URL(input.url).hostname;
    }
    if (isLoopbackHostname(hostname)) {
      return plainFetch(input, init);
    }
    return pinnedFetch(input, init);
  };
}

async function retrieveGeneric(opts: {
  endpointNormalized: string;
  query: string;
  apiKey?: string;
  fetchImpl: typeof fetch;
  lookup?: AuthorityDnsLookupFn;
}): Promise<{ result: RetrievalResult; httpStatus?: number }> {
  const safe = await assertAuthorityEndpointSafeToFetch(opts.endpointNormalized, {
    lookup: opts.lookup,
  });
  if (!safe.ok) {
    return { result: invalidAuthorityEndpointResult(safe.message) };
  }
  const url = `${safe.normalized}?q=${encodeURIComponent(opts.query)}`;
  try {
    const res = await opts.fetchImpl(url, {
      headers: buildAuthorityRequestHeaders({ apiKey: opts.apiKey }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return { result: authorityHttpErrorResult(res.status), httpStatus: res.status };
    }
    const body = (await res.json()) as { hits?: AuthorityHit[]; items?: AuthorityHit[] } | null;
    const rawHits = Array.isArray(body?.hits)
      ? body.hits
      : Array.isArray(body?.items)
        ? body.items
        : [];
    const recognized = Array.isArray(body?.hits) || Array.isArray(body?.items);
    const result = mapHitsToRetrievalResult(rawHits);
    return {
      result: {
        ...result,
        authorityOutcome: {
          status: !recognized
            ? "invalid_response"
            : result.sources.length > 0
              ? "ok"
              : rawHits.length > 0
                ? "invalid_response"
                : "empty",
          httpStatus: res.status,
          hitCount: result.sources.length,
        },
      },
      httpStatus: res.status,
    };
  } catch (e) {
    return {
      result: {
        sources: [],
        claims: [],
        authorityOutcome: {
          status: e instanceof SyntaxError ? "invalid_response" : "unavailable",
          hitCount: 0,
        },
        riskFlags: ["权威检索响应异常或连接失败"],
        missingItems: ["权威检索不可用，请勿编造法条；请律师补充来源。"],
      },
    };
  }
}

type ProviderAttempt = {
  provider: AuthorityProviderId;
  /** False: provider is placeholder / unconfigured and did not make a call. */
  attempted: boolean;
  result: RetrievalResult;
  httpStatus?: number;
};

/**
 * Multi-vendor: 把「以整库口吻说话」的兜底文案缩到**具体库**。
 *
 * `mapHitsToRetrievalResult([])` 与失败兜底写的是「权威库无命中」「权威检索不可用」。
 * 多库时其中一家有命中、另一家空/失败，直接并集会让模型同时看到「有命中」与
 * 「权威库无命中」，于是要么不敢引用已找到的条文，要么把缺源说成整库故障。
 * 这里只改前缀，vendor-specific 文案（如「元典智库未配置」）原样保留。
 */
function scopeVendorNotes(attempt: ProviderAttempt): RetrievalResult {
  const label = authorityProviderLabel(attempt.provider);
  const scope = (note: string): string => {
    if (note === "权威库无命中") {
      return `${label}无命中`;
    }
    if (note.startsWith("权威库未检索到")) {
      return `${label}未检索到${note.slice("权威库未检索到".length)}`;
    }
    if (note.startsWith("权威检索不可用")) {
      return `${label}不可用${note.slice("权威检索不可用".length)}`;
    }
    if (note.startsWith("权威检索异常")) {
      return `${label}检索异常${note.slice("权威检索异常".length)}`;
    }
    return note;
  };
  return {
    ...attempt.result,
    riskFlags: attempt.result.riskFlags.map(scope),
    missingItems: attempt.result.missingItems.map(scope),
  };
}

/** Per-provider config gate: attempted only when its own credentials exist. */
function providerConfigured(
  provider: AuthorityProviderId,
  opts: { raw: string; validatedOk: boolean; workspaceDir: string },
): boolean {
  switch (provider) {
    case "open":
      return true;
    case "lexis":
      return false; // placeholder — never fan out to a fake endpoint
    case "generic":
    case "pkulaw":
      return Boolean(opts.raw && opts.validatedOk);
    case "yuandian":
      return Boolean(resolveYuandianApiKey());
    default:
      return false;
  }
}

/**
 * Build adapter from env. Always safe to register; only flags missing corpus
 * when the intent actually needs authority. Invalid URLs never call fetch.
 */
export function createAuthorityAdapterFromEnv(opts?: {
  endpoint?: string;
  apiKey?: string;
  provider?: string;
  workspaceDir?: string;
  corpusPath?: string;
  fetchImpl?: typeof fetch;
  lookup?: AuthorityDnsLookupFn;
  /** Force 法宝/元典 law vs case gateway (chat tools). */
  searchKind?: PkulawSearchKind;
}): RetrievalAdapter {
  const raw = resolveAuthorityEndpointRaw(opts);
  const fetchImpl = opts?.fetchImpl ?? fetch;
  // Commercial authority endpoints (pkulaw/generic/yuandian) get a connection-layer
  // DNS pin so a DNS rebinding between check and connect cannot redirect to a private IP.
  // Tests that inject fetchImpl bypass the pin and use their mock directly.
  const commercialFetch = opts?.fetchImpl ?? createPinnedAuthorityFetch({ lookup: opts?.lookup });
  // Open-law live endpoints (NPC / caseopen): non-loopback hosts also get the DNS pin;
  // loopback self-hosted caseopen keeps plain fetch (pinned fetch rejects loopback).
  const openLawFetch = opts?.fetchImpl ?? createOpenLawPinnedFetch(fetchImpl, commercialFetch);
  const validated = raw ? validateAuthorityEndpointUrl(raw) : null;
  const providerList = resolveAuthorityProviderList({ provider: opts?.provider });
  const multiVendor = providerList.length > 1;
  const provider: AuthorityProviderId = resolveAuthorityProvider({ provider: opts?.provider });
  const unrecognizedProvider = authorityProviderUnrecognized({ provider: opts?.provider });
  const providerRaw = (opts?.provider ?? process.env.LAWMIND_AUTHORITY_PROVIDER ?? "").trim();
  const apiKey = opts?.apiKey ?? resolveAuthorityApiKey();
  const workspaceDir =
    opts?.workspaceDir?.trim() || process.env.LAWMIND_WORKSPACE_DIR?.trim() || "";
  const lookup = opts?.lookup;

  async function attemptProvider(id: AuthorityProviderId, query: string): Promise<ProviderAttempt> {
    const configured = providerConfigured(id, {
      raw,
      validatedOk: Boolean(validated?.ok),
      workspaceDir,
    });

    if (id === "open") {
      const out = await openLawRetrieve({
        query,
        corpusPath: opts?.corpusPath,
        fetchImpl: openLawFetch,
        lookup,
      });
      return { provider: id, attempted: true, ...out };
    }

    if (id === "lexis") {
      return {
        provider: id,
        attempted: false,
        result: {
          sources: [],
          claims: [],
          riskFlags: ["Lexis 适配器未实现（闭源占位）"],
          missingItems: [lexisAdapterMessage()],
        },
      };
    }

    if (id === "yuandian") {
      if (!configured) {
        return {
          provider: id,
          attempted: false,
          result: {
            sources: [],
            claims: [],
            riskFlags: ["元典智库未配置（LAWMIND_YUANDIAN_API_KEY）"],
            missingItems: [
              "元典智库未配置：不得编造法条编号或裁判要旨；请配置元典开放平台 API Key 或换用其他权威来源。",
            ],
            authorityOutcome: { status: "not_configured", hitCount: 0 },
          },
        };
      }
      const endpointRaw = resolveYuandianEndpoint();
      const v = validateAuthorityEndpointUrl(endpointRaw);
      if (!v.ok) {
        return {
          provider: id,
          attempted: false,
          result: {
            ...invalidAuthorityEndpointResult(v.message),
            authorityOutcome: { status: "invalid_response", hitCount: 0 },
          },
        };
      }
      const out = await yuandianRetrieve({
        endpointNormalized: v.normalized,
        query,
        apiKey: resolveYuandianApiKey(),
        fetchImpl: commercialFetch,
        lookup,
        searchKind: opts?.searchKind,
      });
      return { provider: id, attempted: true, ...out };
    }

    // generic / pkulaw — both require an endpoint (`authorityProviderNeedsEndpoint`)
    if (!raw) {
      return {
        provider: id,
        attempted: false,
        result: unsetAuthorityResult(),
      };
    }
    if (!validated?.ok) {
      return {
        provider: id,
        attempted: false,
        result: invalidAuthorityEndpointResult(validated?.message ?? "未知错误"),
      };
    }
    if (id === "pkulaw") {
      const out = await pkulawRetrieve({
        endpointNormalized: validated.normalized,
        query,
        apiKey,
        mode: resolvePkulawMode({ endpoint: validated.normalized }),
        fetchImpl: commercialFetch,
        lookup,
        searchKind: opts?.searchKind,
      });
      return { provider: id, attempted: true, ...out };
    }
    if (configured) {
      const out = await retrieveGeneric({
        endpointNormalized: validated.normalized,
        query,
        apiKey,
        fetchImpl: commercialFetch,
        lookup,
      });
      return { provider: id, attempted: true, ...out };
    }
    return { provider: id, attempted: false, result: unsetAuthorityResult() };
  }

  return {
    name: "authority",
    supports: (intent) => needsAuthority(intent),
    async retrieve({ intent }): Promise<RetrievalResult> {
      const query = (intent.summary || intent.instruction || "").trim() || "__empty__";
      let attempts: ProviderAttempt[];
      let result: RetrievalResult;

      if (!multiVendor) {
        const single = await attemptProvider(providerList[0] ?? "open", query);
        attempts = [single];
        result = single.result;
        if (unrecognizedProvider) {
          result = {
            ...result,
            riskFlags: [
              `法源提供方「${providerRaw}」无法识别，已退回开源语料，未连接商业库。`,
              ...result.riskFlags,
            ],
          };
        }
        if ((providerList[0] ?? "open") !== "open" && !result.authorityOutcome) {
          // Legacy stamp: not_configured when unset/invalid/lexis, otherwise derive from HTTP.
          const legacyStatus =
            !raw || !validated?.ok || provider === "lexis"
              ? ("not_configured" as const)
              : single.httpStatus != null
                ? authorityHttpStatus(single.httpStatus)
                : ("unavailable" as const);
          result.authorityOutcome = {
            status: legacyStatus,
            httpStatus: single.httpStatus,
            hitCount: result.sources.length,
          };
        }
      } else {
        attempts = await Promise.all(providerList.map((id) => attemptProvider(id, query)));
        const merged = mergeRetrievalResults(attempts.map((a) => scopeVendorNotes(a)));
        result = merged;
        const attemptedAny = attempts.some((a) => a.attempted);
        if (!attemptedAny && !result.authorityOutcome) {
          result.authorityOutcome = { status: "not_configured", hitCount: 0 };
        }
        if (unrecognizedProvider) {
          result = {
            ...result,
            riskFlags: [
              `法源提供方「${providerRaw}」含无法识别的取值，已只使用可识别的库（fail-closed，未编造）。`,
              ...result.riskFlags,
            ],
          };
        }
      }

      // Per-provider metering (multi-vendor keeps byProvider attribution honest).
      // Only real calls are metered: a skipped (unconfigured) vendor must not look
      // like a failed request in Doctor's 今日调用统计.
      if (workspaceDir) {
        for (const attempt of attempts) {
          if (!attempt.attempted) {
            continue;
          }
          try {
            const call = attempt.result.authorityOutcome;
            recordAuthorityUsage(workspaceDir, {
              ok: call
                ? authorityCallSucceeded(call.status)
                : attempt.result.sources.length > 0 && attempt.result.missingItems.length === 0,
              httpStatus: attempt.httpStatus,
              provider: attempt.provider,
              outcome: call,
            });
          } catch {
            /* metering must not break retrieval */
          }
        }
      }
      return result;
    },
  };
}
