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
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import type { RetrievalResult } from "../../index.js";
import { inferPkulawSearchKind, mapPkulawResponseBody, type PkulawSearchKind } from "./map.js";

export type { PkulawSearchKind };

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

function jsonRpcErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const o = body as { error?: { message?: string }; result?: { isError?: boolean } };
  if (typeof o.error?.message === "string" && o.error.message.trim()) {
    return o.error.message.trim();
  }
  if (o.result?.isError === true) {
    return "法宝 MCP 工具返回 isError";
  }
  return undefined;
}

export async function pkulawRetrieve(opts: {
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
  const mode = opts.mode ?? resolvePkulawMode();
  const searchType = opts.searchKind ?? inferPkulawSearchKind(opts.query);
  const requestedEndpoint =
    mode === "mcp_tools_call" && searchType === "case"
      ? resolvePkulawCaseEndpoint(opts.endpointNormalized)
      : opts.endpointNormalized;
  const safe = await assertAuthorityEndpointSafeToFetch(requestedEndpoint, {
    lookup: opts.lookup,
  });
  if (!safe.ok) {
    return { result: invalidAuthorityEndpointResult(safe.message) };
  }
  const endpointNormalized = safe.normalized;
  const headers = mcpHeaders(opts.apiKey);
  const timeoutMs = opts.timeoutMs ?? 12_000;

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

    if (!res.ok) {
      return { result: authorityHttpErrorResult(res.status), httpStatus: res.status };
    }
    const body = await readJsonRpcBody(res);
    const rpcError = jsonRpcErrorMessage(body);
    if (rpcError) {
      return {
        result: {
          sources: [],
          claims: [],
          riskFlags: [`权威检索异常：${rpcError}`],
          missingItems: ["权威检索不可用，请勿编造法条；请律师补充来源。"],
        },
        httpStatus: res.status,
      };
    }
    // MCP envelope: { result: { content, structuredContent } }
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
