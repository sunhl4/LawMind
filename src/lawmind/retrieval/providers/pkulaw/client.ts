/**
 * 北大法宝 authority client (C1-1).
 *
 * Modes (LAWMIND_PKULAW_MODE):
 * - rest_compat (default): GET {endpoint}?q= — LawMind shim / compatible gateway
 * - search_post: POST { query, searchType } JSON body
 * - mcp_tools_call: POST MCP-style { method: "tools/call", params: { name, arguments } }
 *
 * Real vendor Token / gateway URL: USER placeholder (see LAWMIND-EXTERNAL-INTEGRATIONS).
 */

import {
  assertAuthorityEndpointSafeToFetch,
  buildAuthorityRequestHeaders,
} from "../../authority-health.js";
import {
  authorityHttpErrorResult,
  invalidAuthorityEndpointResult,
  mapHitsToRetrievalResult,
} from "../../authority-hits.js";
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import type { RetrievalResult } from "../../index.js";
import { inferPkulawSearchKind, mapPkulawResponseBody } from "./map.js";

export type PkulawMode = "rest_compat" | "search_post" | "mcp_tools_call";

export function resolvePkulawMode(opts?: { mode?: string }): PkulawMode {
  const raw = (opts?.mode ?? process.env.LAWMIND_PKULAW_MODE ?? "rest_compat").trim().toLowerCase();
  if (raw === "search_post" || raw === "post") {
    return "search_post";
  }
  if (raw === "mcp_tools_call" || raw === "mcp") {
    return "mcp_tools_call";
  }
  return "rest_compat";
}

export async function pkulawRetrieve(opts: {
  endpointNormalized: string;
  query: string;
  apiKey?: string;
  mode?: PkulawMode;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  lookup?: AuthorityDnsLookupFn;
}): Promise<{ result: RetrievalResult; httpStatus?: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const mode = opts.mode ?? resolvePkulawMode();
  const safe = await assertAuthorityEndpointSafeToFetch(opts.endpointNormalized, {
    lookup: opts.lookup,
  });
  if (!safe.ok) {
    return { result: invalidAuthorityEndpointResult(safe.message) };
  }
  const endpointNormalized = safe.normalized;
  const headers = {
    ...buildAuthorityRequestHeaders({ apiKey: opts.apiKey }),
    "content-type": "application/json",
  };
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const searchType = inferPkulawSearchKind(opts.query);

  try {
    let res: Response;
    if (mode === "rest_compat") {
      const url = `${endpointNormalized}?q=${encodeURIComponent(opts.query)}&type=${searchType}`;
      res = await fetchImpl(url, {
        headers: buildAuthorityRequestHeaders({ apiKey: opts.apiKey }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } else if (mode === "search_post") {
      res = await fetchImpl(endpointNormalized, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: opts.query, searchType, q: opts.query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } else {
      const toolName =
        searchType === "case"
          ? (process.env.LAWMIND_PKULAW_MCP_CASE_TOOL ?? "case_search")
          : (process.env.LAWMIND_PKULAW_MCP_LAW_TOOL ?? "law_search");
      res = await fetchImpl(endpointNormalized, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: toolName,
            arguments: { query: opts.query, q: opts.query },
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    }

    if (!res.ok) {
      return { result: authorityHttpErrorResult(res.status), httpStatus: res.status };
    }
    const body = await res.json();
    // MCP envelope: { result: { content: [...] } }
    const envelope =
      body && typeof body === "object" && "result" in body
        ? (body as { result: unknown }).result
        : body;
    const hits = mapPkulawResponseBody(envelope);
    return { result: mapHitsToRetrievalResult(hits), httpStatus: res.status };
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
