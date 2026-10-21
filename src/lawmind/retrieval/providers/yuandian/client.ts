/**
 * 元典 (YuanDian) authority client — open.chineselaw.com 开放平台.
 *
 * 传输：官方 Streamable HTTP MCP Server（`https://open.chineselaw.com/mcp`），
 * 与 npm 官方代理 `yuandian-mcp-server` 指向的远端一致，鉴权 `Authorization: Bearer <API Key>`。
 *
 * MCP 生命周期（Streamable HTTP 规范要求 initialize 握手）：
 * 1. POST `initialize` → 响应头携带 `Mcp-Session-Id`；
 * 2. POST `notifications/initialized`（通知，无 id，忽略响应体）；
 * 3. POST `tools/call`（携带 `Mcp-Session-Id`，同进程内复用会话）。
 * 会话失效（404 / 400 会话报错）时重新握手一次再重试 tools/call。
 *
 * 环境变量：
 * - LAWMIND_YUANDIAN_API_KEY     必填（元典开放平台 API Key，不与法宝 Key 共享）
 * - LAWMIND_YUANDIAN_ENDPOINT    可选，默认 https://open.chineselaw.com/mcp
 * - LAWMIND_YUANDIAN_MODE        可选 keyword（默认，法条/案例关键词检索）| vector（语义检索）
 * - LAWMIND_YUANDIAN_LAW_TOOL    可选，默认 yuandian_rh_ft_search（vector 模式 yuandian_law_vector_search）
 * - LAWMIND_YUANDIAN_CASE_TOOL   可选，默认 yuandian_rh_ptal_search（vector 模式 yuandian_case_vector_search）
 *
 * 安全：SSRF 校验 + 连接层 DNS pin 由 authority-adapter 完成；此处再过 outbound-proxy。
 */

import { createOutboundProxy } from "../../../platform/outbound-proxy.js";
import {
  assertAuthorityEndpointSafeToFetch,
  buildAuthorityRequestHeaders,
} from "../../authority-health.js";
import { invalidAuthorityEndpointResult, mapHitsToRetrievalResult } from "../../authority-hits.js";
import { authorityFailureMessage, type AuthorityCallStatus } from "../../authority-outcome.js";
import { authorityProviderDefaultEndpoint } from "../../authority-provider.js";
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import type { RetrievalResult } from "../../index.js";
import { pkulawResponseStatus } from "../pkulaw/outcome.js";
import { mapYuandianResponseBody } from "./map.js";

export type YuandianSearchKind = "law" | "case";
export type YuandianMode = "keyword" | "vector";

export const YUANDIAN_DEFAULT_ENDPOINT = authorityProviderDefaultEndpoint("yuandian") as string;

/** Vendor-neutral envelope inspection lives in pkulaw/outcome.ts; reuse, don't fork. */

export function resolveYuandianEndpoint(opts?: { endpoint?: string }): string {
  return (
    opts?.endpoint?.trim() ||
    process.env.LAWMIND_YUANDIAN_ENDPOINT?.trim() ||
    YUANDIAN_DEFAULT_ENDPOINT
  );
}

export function resolveYuandianApiKey(opts?: { apiKey?: string }): string {
  return opts?.apiKey?.trim() || process.env.LAWMIND_YUANDIAN_API_KEY?.trim() || "";
}

export function resolveYuandianMode(opts?: { mode?: string }): YuandianMode {
  const raw = (opts?.mode ?? process.env.LAWMIND_YUANDIAN_MODE ?? "keyword").trim().toLowerCase();
  return raw === "vector" || raw === "semantic" ? "vector" : "keyword";
}

export function resolveYuandianTools(opts?: {
  mode?: YuandianMode;
  lawTool?: string;
  caseTool?: string;
}): { law: string; case: string } {
  const vector = (opts?.mode ?? resolveYuandianMode()) === "vector";
  const lawDefault = vector ? "yuandian_law_vector_search" : "yuandian_rh_ft_search";
  const caseDefault = vector ? "yuandian_case_vector_search" : "yuandian_rh_ptal_search";
  const law = (opts?.lawTool ?? process.env.LAWMIND_YUANDIAN_LAW_TOOL ?? lawDefault).trim();
  const caseTool = (opts?.caseTool ?? process.env.LAWMIND_YUANDIAN_CASE_TOOL ?? caseDefault).trim();
  return { law: law || lawDefault, case: caseTool || caseDefault };
}

/** Tool arguments per documented interface contracts; 请求体不能为空 for keyword tools. */
export function buildYuandianArguments(
  kind: YuandianSearchKind,
  query: string,
): Record<string, unknown> {
  if (resolveYuandianMode() === "vector") {
    return kind === "case" ? { query, wenshu_filter: {}, top_k: 10 } : { query, top_k: 10 };
  }
  return { keyword: query, page_size: 10 };
}

function failedResult(status: AuthorityCallStatus, httpStatus?: number): RetrievalResult {
  return {
    sources: [],
    claims: [],
    riskFlags: [`元典智库：${authorityFailureMessage(status)}`],
    missingItems: ["本次权威引用未核实；可继续整理材料、分析和起草，不得把缺失来源写成已核实。"],
    authorityOutcome: { status, httpStatus, hitCount: 0 },
  };
}

function jsonHeaders(apiKey?: string, sessionId?: string): Record<string, string> {
  return {
    ...buildAuthorityRequestHeaders({ apiKey }),
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-03-26",
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  };
}

/** Session id reuse keyed by endpoint (secret never enters the key). */
const sessionCache = new Map<string, string>();

/** Test hook: reset cached MCP sessions between tests. */
export function resetYuandianSessionsForTest(): void {
  sessionCache.clear();
}

function extractSessionId(res: Response): string | undefined {
  return res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id") ?? undefined;
}

async function readJsonRpcBody(res: Response): Promise<Record<string, unknown> | null> {
  const text = (await res.text()).trim();
  if (!text) {
    return null;
  }
  const ct = res.headers.get("content-type") ?? "";
  const jsonText =
    ct.includes("text/event-stream") || text.startsWith("event:")
      ? ([...text.matchAll(/^data:\s*(.+)$/gm)]
          .map((m) => m[1]?.trim() ?? "")
          .filter(Boolean)
          .at(-1) ?? "")
      : text;
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sessionInvalid(res: Response): boolean {
  // 404: unknown/expired session id. 400/409: servers that reject an un- or
  // mis-initialized session. A genuinely bad argument repeats 400 and still
  // surfaces as failed — the one-shot retry costs a single extra call.
  return res.status === 404 || res.status === 400 || res.status === 409;
}

async function initializeSession(opts: {
  endpoint: string;
  headers: Record<string, string>;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<string | undefined> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "lawmind", version: "0.2.0" },
    },
  });
  let res: Response;
  try {
    res = await opts.fetchImpl(opts.endpoint, {
      method: "POST",
      headers: opts.headers,
      body,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch {
    return undefined;
  }
  if (!res.ok && res.status !== 202) {
    return undefined;
  }
  const sessionId = extractSessionId(res);
  // Per spec, initialized notification follows initialize. Ignore failures —
  // stateless servers don't need it, stateful ones tolerate it.
  if (sessionId) {
    try {
      await opts.fetchImpl(opts.endpoint, {
        method: "POST",
        headers: jsonHeaders(opts.headers.authorization.replace(/^Bearer /, ""), sessionId),
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch {
      /* ignore */
    }
  }
  return sessionId;
}

export async function yuandianRetrieve(opts: {
  endpointNormalized: string;
  query: string;
  apiKey?: string;
  lookup?: AuthorityDnsLookupFn;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  searchKind?: YuandianSearchKind;
}): Promise<{ result: RetrievalResult; httpStatus?: number }> {
  const searchKind: YuandianSearchKind = opts.searchKind ?? "law";
  const proxy = createOutboundProxy({
    fetchImpl: opts.fetchImpl,
    allowLocalNetwork: true,
    requestTag: "yuandian",
  });
  const fetchImpl = proxy.fetch.bind(proxy);
  const tools = resolveYuandianTools();
  const toolName = searchKind === "case" ? tools.case : tools.law;
  const safe = await assertAuthorityEndpointSafeToFetch(opts.endpointNormalized, {
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
  const endpoint = safe.normalized;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const cacheKey = endpoint;

  const callTool = async (fetchFn: typeof fetch, sessionId?: string): Promise<Response> =>
    fetchFn(endpoint, {
      method: "POST",
      headers: jsonHeaders(opts.apiKey, sessionId),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: buildYuandianArguments(searchKind, opts.query),
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

  let httpStatus: number | undefined;
  try {
    let sessionId = sessionCache.get(cacheKey);
    if (!sessionId) {
      sessionId = await initializeSession({
        endpoint,
        headers: jsonHeaders(opts.apiKey),
        fetchImpl,
        timeoutMs,
      });
      if (sessionId) {
        sessionCache.set(cacheKey, sessionId);
      }
    }
    let res = await callTool(fetchImpl, sessionId);
    if (sessionId && sessionInvalid(res)) {
      // Cached session died — re-handshake once and retry.
      sessionCache.delete(cacheKey);
      sessionId = await initializeSession({
        endpoint,
        headers: jsonHeaders(opts.apiKey),
        fetchImpl,
        timeoutMs,
      });
      if (sessionId) {
        sessionCache.set(cacheKey, sessionId);
      }
      res = await callTool(fetchImpl, sessionId);
    }
    httpStatus = res.status;
    if (res.status === 401 || res.status === 403) {
      return { result: failedResult("unauthorized", httpStatus), httpStatus };
    }
    if (res.status === 402 || res.status === 429) {
      return {
        result: failedResult(res.status === 402 ? "quota_exhausted" : "rate_limited", httpStatus),
        httpStatus,
      };
    }
    if (!res.ok) {
      return { result: failedResult("unavailable", httpStatus), httpStatus };
    }
    const body = await readJsonRpcBody(res);
    const envelope = body?.result ?? body;
    const hits = mapYuandianResponseBody(envelope);
    const status = pkulawResponseStatus(envelope, hits.length);
    const mapped = mapHitsToRetrievalResult(hits);
    return {
      result: {
        ...mapped,
        authorityOutcome: {
          status,
          httpStatus,
          hitCount: mapped.sources.length,
        },
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
