/**
 * Authority retrieval adapter (P2-1 / R-P0-4 / Track B).
 *
 * Routes by LAWMIND_AUTHORITY_PROVIDER:
 * - open (default): local open corpus (+ optional NPC FLK) — no commercial key
 * - generic: GET ?q= → hits/items
 * - pkulaw / lexis: commercial BYOK / placeholder（手动接入）
 */

import type { TaskIntent } from "../types.js";
import type { RetrievalAdapter, RetrievalResult } from "./index.js";
import {
  authorityHttpErrorResult,
  invalidAuthorityEndpointResult,
  mapHitsToRetrievalResult,
  type AuthorityHit,
  unsetAuthorityResult,
} from "./authority-hits.js";
import {
  assertAuthorityEndpointSafeToFetch,
  buildAuthorityRequestHeaders,
  resolveAuthorityApiKey,
  resolveAuthorityEndpointRaw,
  validateAuthorityEndpointUrl,
} from "./authority-health.js";
import { createPinnedAuthorityFetch } from "./authority-pinned-fetch.js";
import {
  authorityProviderNeedsEndpoint,
  resolveAuthorityProvider,
  type AuthorityProviderId,
} from "./authority-provider.js";
import type { AuthorityDnsLookupFn } from "./authority-url-guard.js";
import { recordAuthorityUsage } from "./authority-usage.js";
import { lexisAdapterMessage } from "./providers/lexis/placeholder.js";
import { openLawRetrieve } from "./providers/open-law/client.js";
import { pkulawRetrieve, resolvePkulawMode } from "./providers/pkulaw/client.js";

export type { AuthorityHit };

function needsAuthority(intent: TaskIntent): boolean {
  return (
    intent.kind === "research.legal" ||
    intent.kind === "research.hybrid" ||
    /(法条|法规|民法典|司法解释|判例|权威)/.test(intent.instruction ?? intent.summary ?? "")
  );
}

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
 * Wrap fetch so that non-loopback open-law live endpoints (NPC / caseopen with
 * a custom non-local host) go through the connection-layer DNS pin, while
 * loopback self-hosted caseopen keeps using plain fetch (pinned fetch rejects
 * loopback by design). This closes the DNS-rebinding TOCTOU for non-loopback
 * open-law endpoints without breaking the local self-hosted use case.
 */
function createOpenLawPinnedFetch(plainFetch: typeof fetch, pinnedFetch: typeof fetch): typeof fetch {
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
    const body = (await res.json()) as { hits?: AuthorityHit[]; items?: AuthorityHit[] };
    const rawHits = Array.isArray(body.hits)
      ? body.hits
      : Array.isArray(body.items)
        ? body.items
        : [];
    return { result: mapHitsToRetrievalResult(rawHits), httpStatus: res.status };
  } catch (e) {
    return {
      result: {
        sources: [],
        claims: [],
        riskFlags: [`权威检索异常：${e instanceof Error ? e.message : String(e)}`],
        missingItems: ["权威检索不可用，请勿编造法条；请律师补充来源。"],
      },
    };
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
}): RetrievalAdapter {
  const raw = resolveAuthorityEndpointRaw(opts);
  const fetchImpl = opts?.fetchImpl ?? fetch;
  // Commercial authority endpoints (pkulaw/generic) get a connection-layer DNS pin so
  // a DNS rebinding between check and connect cannot redirect to a private IP. Tests that
  // inject fetchImpl bypass the pin and use their mock directly.
  const commercialFetch = opts?.fetchImpl ?? createPinnedAuthorityFetch({ lookup: opts?.lookup });
  // Open-law live endpoints (NPC / caseopen): non-loopback hosts also get the DNS pin;
  // loopback self-hosted caseopen keeps plain fetch (pinned fetch rejects loopback).
  const openLawFetch = opts?.fetchImpl ?? createOpenLawPinnedFetch(fetchImpl, commercialFetch);
  const validated = raw ? validateAuthorityEndpointUrl(raw) : null;
  const provider: AuthorityProviderId = resolveAuthorityProvider({ provider: opts?.provider });
  const apiKey = opts?.apiKey ?? resolveAuthorityApiKey();
  const workspaceDir = opts?.workspaceDir?.trim() || process.env.LAWMIND_WORKSPACE_DIR?.trim() || "";
  const lookup = opts?.lookup;

  return {
    name: "authority",
    supports: (intent) => needsAuthority(intent),
    async retrieve({ intent }): Promise<RetrievalResult> {
      const query = (intent.summary || intent.instruction || "").trim() || "__empty__";
      let outcome: { result: RetrievalResult; httpStatus?: number };

      if (provider === "open") {
        outcome = await openLawRetrieve({
          query,
          corpusPath: opts?.corpusPath,
          fetchImpl: openLawFetch,
          lookup,
        });
      } else if (provider === "lexis") {
        outcome = {
          result: {
            sources: [],
            claims: [],
            riskFlags: ["Lexis 适配器未实现（闭源占位）"],
            missingItems: [lexisAdapterMessage()],
          },
        };
      } else if (authorityProviderNeedsEndpoint(provider)) {
        if (!raw) {
          outcome = { result: unsetAuthorityResult() };
        } else if (!validated?.ok) {
          outcome = {
            result: invalidAuthorityEndpointResult(validated?.message ?? "未知错误"),
          };
        } else if (provider === "pkulaw") {
          outcome = await pkulawRetrieve({
            endpointNormalized: validated.normalized,
            query,
            apiKey,
            mode: resolvePkulawMode(),
            fetchImpl: commercialFetch,
            lookup,
          });
        } else {
          outcome = await retrieveGeneric({
            endpointNormalized: validated.normalized,
            query,
            apiKey,
            fetchImpl: commercialFetch,
            lookup,
          });
        }
      } else {
        outcome = { result: unsetAuthorityResult() };
      }

      if (workspaceDir) {
        try {
          recordAuthorityUsage(workspaceDir, {
            ok: outcome.result.sources.length > 0 && outcome.result.missingItems.length === 0,
            httpStatus: outcome.httpStatus,
            provider,
          });
        } catch {
          /* metering must not break retrieval */
        }
      }
      return outcome.result;
    },
  };
}
