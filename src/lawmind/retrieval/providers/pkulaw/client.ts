/**
 * 北大法宝 authority client (C1-1).
 *
 * Modes (LAWMIND_PKULAW_MODE):
 * - rest_compat (default): GET {endpoint}?q= — LawMind shim / compatible gateway
 * - search_post: POST { query, searchType } JSON body
 * - mcp_tools_call: POST MCP-style { method: "tools/call", params: { name, arguments } }
 *
 * Official mcp.pkulaw.com gateways expect tool `search_article` / `search_case`
 * with `{ text }` (query/q kept for LawMind shims).
 */

import { createOutboundProxy } from "../../../platform/outbound-proxy.js";
import {
  assertAuthorityEndpointSafeToFetch,
  buildAuthorityRequestHeaders,
} from "../../authority-health.js";
import {
  authorityHttpErrorResult,
  invalidAuthorityEndpointResult,
  mapHitsToRetrievalResult,
} from "../../authority-hits.js";
import {
  authorityCallSucceeded,
  authorityFailureMessage,
  authorityHttpStatus,
  type AuthorityCallStatus,
} from "../../authority-outcome.js";
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import type { RetrievalResult } from "../../index.js";
import { inferPkulawSearchKind, mapPkulawResponseBody, type PkulawSearchKind } from "./map.js";
import { pkulawResponseStatus } from "./outcome.js";

export type { PkulawSearchKind };

export type PkulawMode = "rest_compat" | "search_post" | "mcp_tools_call";

export function endpointWantsPkulawMcp(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.hostname === "apim-gateway.pkulaw.com" || url.pathname.includes("/mcp-");
  } catch {
    return false;
  }
}

export function resolvePkulawMode(opts?: { mode?: string; endpoint?: string }): PkulawMode {
  const raw = (opts?.mode ?? process.env.LAWMIND_PKULAW_MODE ?? "rest_compat").trim().toLowerCase();
  if (raw === "search_post" || raw === "post") {
    return "search_post";
  }
  if (raw === "mcp_tools_call" || raw === "mcp") {
    return "mcp_tools_call";
  }
  // Official MCP gateway rejects GET ?q= with HTTP 401 "MCP Failure".
  if (opts?.endpoint && endpointWantsPkulawMcp(opts.endpoint)) {
    return "mcp_tools_call";
  }
  return "rest_compat";
}

export function resolvePkulawMcpTools(opts?: { lawTool?: string; caseTool?: string }): {
  law: string;
  case: string;
} {
  const law = (opts?.lawTool ?? process.env.LAWMIND_PKULAW_MCP_LAW_TOOL ?? "search_article").trim();
  const caseTool = (
    opts?.caseTool ??
    process.env.LAWMIND_PKULAW_MCP_CASE_TOOL ??
    "search_case"
  ).trim();
  return {
    law: law || "search_article",
    case: caseTool || "search_case",
  };
}

export function resolvePkulawCaseEndpoint(lawEndpoint: string): string {
  return process.env.LAWMIND_PKULAW_CASE_ENDPOINT?.trim() || lawEndpoint;
}

function mcpHeaders(apiKey?: string): Record<string, string> {
  return {
    ...buildAuthorityRequestHeaders({ apiKey }),
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
}

/** Official mcp.pkulaw.com tools reject unknown fields (query/q → isError). */
export function buildPkulawMcpArguments(query: string): Record<string, string | number> {
  return { text: query, size: 10 };
}

async function readJsonRpcBody(res: Response): Promise<unknown> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream") || trimmed.startsWith("event:")) {
    const matches = [...trimmed.matchAll(/^data:\s*(.+)$/gm)].map((m) => m[1]?.trim() ?? "");
    const last = matches.filter(Boolean).at(-1);
    if (last) {
      return JSON.parse(last) as unknown;
    }
  }
  return JSON.parse(trimmed) as unknown;
}

function failedResult(status: AuthorityCallStatus, httpStatus?: number): RetrievalResult {
  return {
    sources: [],
    claims: [],
    riskFlags: [authorityFailureMessage(status)],
    missingItems: ["本次权威引用未核实；可继续整理材料、分析和起草，不得把缺失来源写成已核实。"],
    authorityOutcome: { status, httpStatus, hitCount: 0 },
  };
}

export async function pkulawRetrieve(
  opts: Parameters<typeof retrievePkulaw>[0],
): Promise<Awaited<ReturnType<typeof retrievePkulaw>>> {
  return retrievePkulaw(opts);
}

async function retrievePkulaw(opts: {
  endpointNormalized: string;
  query: string;
  apiKey?: string;
  mode?: PkulawMode;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  lookup?: AuthorityDnsLookupFn;
  /** Force law vs case gateway; default infers from query text. */
  searchKind?: PkulawSearchKind;
}): Promise<{ result: RetrievalResult; httpStatus?: number }> {
  const pkulawProxy = createOutboundProxy({
    fetchImpl: opts.fetchImpl,
    allowLocalNetwork: true,
    requestTag: "pkulaw",
  });
  const fetchImpl = pkulawProxy.fetch.bind(pkulawProxy);
  const mode = opts.mode ?? resolvePkulawMode({ endpoint: opts.endpointNormalized });
  const searchType = opts.searchKind ?? inferPkulawSearchKind(opts.query);
  const requestedEndpoint =
    mode === "mcp_tools_call" && searchType === "case"
      ? resolvePkulawCaseEndpoint(opts.endpointNormalized)
      : opts.endpointNormalized;
  const safe = await assertAuthorityEndpointSafeToFetch(requestedEndpoint, {
    lookup: opts.lookup,
  });
  if (!safe.ok) {
    return {
      result: {
        ...invalidAuthorityEndpointResult(safe.message),
        authorityOutcome: { status: "unavailable", hitCount: 0 },
      },
    };
  }
  const endpointNormalized = safe.normalized;
  const headers = mcpHeaders(opts.apiKey);
  const timeoutMs = opts.timeoutMs ?? 12_000;

  let httpStatus: number | undefined;
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
        body: JSON.stringify({ query: opts.query, searchType, q: opts.query, text: opts.query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } else {
      const tools = resolvePkulawMcpTools();
      const toolName = searchType === "case" ? tools.case : tools.law;
      res = await fetchImpl(endpointNormalized, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: toolName,
            arguments: buildPkulawMcpArguments(opts.query),
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    }

    httpStatus = res.status;
    if (!res.ok) {
      return {
        result: {
          ...authorityHttpErrorResult(res.status),
          authorityOutcome: { status: authorityHttpStatus(res.status), httpStatus, hitCount: 0 },
        },
        httpStatus,
      };
    }
    const body = await readJsonRpcBody(res);
    // MCP envelope: { result: { content, structuredContent } }
    const envelope =
      body && typeof body === "object" && "result" in body
        ? (body as { result: unknown }).result
        : body;
    const hits = mapPkulawResponseBody(envelope);
    const status = pkulawResponseStatus(body, hits.length);
    if (!authorityCallSucceeded(status)) {
      return { result: failedResult(status, httpStatus), httpStatus };
    }
    const result = mapHitsToRetrievalResult(hits);
    return {
      result: {
        ...result,
        authorityOutcome: { status, httpStatus, hitCount: result.sources.length },
      },
      httpStatus,
    };
  } catch (e) {
    return {
      result: failedResult(
        e instanceof SyntaxError ? "invalid_response" : "unavailable",
        httpStatus,
      ),
      httpStatus,
    };
  }
}
