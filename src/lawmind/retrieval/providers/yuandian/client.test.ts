import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildYuandianArguments,
  resolveYuandianEndpoint,
  resetYuandianSessionsForTest,
  resolveYuandianTools,
  YUANDIAN_DEFAULT_ENDPOINT,
  yuandianRetrieve,
} from "./client.js";

type Json = Record<string, unknown>;

function fetchInputUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function requestBodyText(body: BodyInit | null | undefined): string {
  return typeof body === "string" ? body : "{}";
}

/** Fetch double implementing a minimal Streamable-HTTP MCP server. */
function mcpFetchMock(caseRow: Json) {
  let sessionCounter = 0;
  const calls: Array<{ method: string; tool?: string; args?: unknown; headers: HeadersInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(requestBodyText(init?.body)) as Json;
    calls.push({
      method: typeof body.method === "string" ? body.method : "",
      ...(body.params && typeof body.params === "object"
        ? {
            tool: (body.params as Json).name as string | undefined,
            args: (body.params as Json).arguments,
          }
        : {}),
      headers: init?.headers ?? {},
    });
    const urlText = fetchInputUrl(url);
    if (!urlText.startsWith("https://")) {
      throw new Error(`unexpected url ${urlText}`);
    }
    if (body.method === "initialize") {
      sessionCounter += 1;
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          result: {
            protocolVersion: "2025-03-26",
            serverInfo: { name: "yuandian-open", version: "1.0" },
          },
        }),
        { status: 200, headers: { "mcp-session-id": `sess-${sessionCounter}` } },
      );
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    if (body.method === "tools/call") {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          structuredContent: { total: 1, list: [caseRow] },
        },
      });
    }
    return Response.json(
      { jsonrpc: "2.0", id: 2, error: { code: -32601, message: "unknown method" } },
      { status: 400 },
    );
  });
  return { impl, calls };
}

beforeEach(() => {
  resetYuandianSessionsForTest();
  delete process.env.LAWMIND_YUANDIAN_MODE;
  delete process.env.LAWMIND_YUANDIAN_LAW_TOOL;
  delete process.env.LAWMIND_YUANDIAN_CASE_TOOL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CASE_ROW = {
  id: "case-1",
  title: "XX借款合同纠纷",
  case_number: "（2023）京0105民初99999号",
  content: "本院认为……",
};

describe("yuandianRetrieve", () => {
  it("performs initialize → initialized → tools/call and maps case hits", async () => {
    const mock = mcpFetchMock(CASE_ROW);
    const { result, httpStatus } = await yuandianRetrieve({
      endpointNormalized: YUANDIAN_DEFAULT_ENDPOINT,
      query: "借款合同 但书 案例",
      apiKey: "key-yd",
      searchKind: "case",
      fetchImpl: mock.impl as unknown as typeof fetch,
    });
    expect(httpStatus).toBe(200);
    expect(result.authorityOutcome?.status).toBe("ok");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.provider).toBe("yuandian");
    expect(result.claims.every((c) => c.sourceIds.length > 0)).toBe(true);
    const initiated = mock.calls.filter((c) => c.method === "initialize");
    const toolCalls = mock.calls.filter((c) => c.method === "tools/call");
    expect(initiated).toHaveLength(1);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.tool).toBe("yuandian_rh_ptal_search");
    expect(toolCalls[0]?.args).toEqual({ keyword: "借款合同 但书 案例", page_size: 10 });
    expect(JSON.stringify(toolCalls[0])).toContain("借款合同");
  });

  it("caches the MCP session across retrieves (no second initialize)", async () => {
    const mock = mcpFetchMock(CASE_ROW);
    const fetchImpl = mock.impl as unknown as typeof fetch;
    for (let i = 0; i < 2; i += 1) {
      const { result } = await yuandianRetrieve({
        endpointNormalized: YUANDIAN_DEFAULT_ENDPOINT,
        query: `案例 ${i}`,
        apiKey: "key-yd",
        searchKind: "case",
        fetchImpl,
      });
      expect(result.authorityOutcome?.status).toBe("ok");
    }
    expect(mock.calls.filter((c) => c.method === "initialize")).toHaveLength(1);
    expect(mock.calls.filter((c) => c.method === "tools/call")).toHaveLength(2);
    // Second tools/call reuses the session id header.
    const second = mock.calls.at(-1)?.headers as Record<string, string>;
    expect(second["mcp-session-id"]).toBe("sess-1");
  });

  it("re-handshakes after the server loses the session (404) and retries once", async () => {
    let seenSession = false;
    const impl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(requestBodyText(init?.body)) as Json;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (body.method === "initialize") {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 0, result: { protocolVersion: "2025-03-26" } }),
            {
              status: 200,
              headers: { "mcp-session-id": "fresh" },
            },
          );
        }
        if (body.method === "notifications/initialized") {
          return new Response(null, { status: 202 });
        }
        if (body.method === "tools/call") {
          if (headers["mcp-session-id"] === "fresh" && !seenSession) {
            seenSession = true;
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                error: { code: -32001, message: "session expired" },
              }),
              { status: 404 },
            );
          }
          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: { structuredContent: { list: [CASE_ROW] } },
          });
        }
        return new Response(null, { status: 400 });
      },
    );
    const { result } = await yuandianRetrieve({
      endpointNormalized: YUANDIAN_DEFAULT_ENDPOINT,
      query: "案例",
      apiKey: "key-yd",
      searchKind: "case",
      fetchImpl: impl as unknown as typeof fetch,
    });
    expect(result.authorityOutcome?.status).toBe("ok");
    expect(result.sources).toHaveLength(1);
    expect(impl).toHaveBeenCalledTimes(6); // init, initialized, call(404), init, initialized, call(ok)
  });

  it("maps HTTP 401 to unauthorized fail-closed output without leaking the key", async () => {
    const impl = vi.fn(async (): Promise<Response> => new Response("denied", { status: 401 }));
    const { result } = await yuandianRetrieve({
      endpointNormalized: YUANDIAN_DEFAULT_ENDPOINT,
      query: "法规",
      apiKey: "topsecret",
      searchKind: "law",
      fetchImpl: impl as unknown as typeof fetch,
    });
    expect(result.authorityOutcome?.status).toBe("unauthorized");
    expect(result.sources).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("topsecret");
  });

  it("refuses private-network endpoints (fail-closed SSRF)", async () => {
    const impl = vi.fn();
    const { result } = await yuandianRetrieve({
      endpointNormalized: "http://169.254.169.254/latest",
      query: "法规",
      apiKey: "k",
      searchKind: "law",
      fetchImpl: impl as unknown as typeof fetch,
    });
    expect(impl).not.toHaveBeenCalled();
    expect(result.sources).toEqual([]);
    expect(result.riskFlags.join("\n")).toContain("权威端点拒绝");
  });

  it("law mode defaults to keyword statute search with law filters", async () => {
    expect(resolveYuandianEndpoint()).toBe(YUANDIAN_DEFAULT_ENDPOINT);
    expect(resolveYuandianTools()).toEqual({
      law: "yuandian_rh_ft_search",
      case: "yuandian_rh_ptal_search",
    });
    expect(resolveYuandianTools({ mode: "vector" })).toEqual({
      law: "yuandian_law_vector_search",
      case: "yuandian_case_vector_search",
    });
    expect(buildYuandianArguments("law", "民法典")).toEqual({ keyword: "民法典", page_size: 10 });
  });

  it("vector mode switches tool names and arguments", async () => {
    process.env.LAWMIND_YUANDIAN_MODE = "vector";
    expect(buildYuandianArguments("law", "合同解除的法定情形")).toEqual({
      query: "合同解除的法定情形",
      top_k: 10,
    });
    expect(buildYuandianArguments("case", "合同解除的法定情形")).toEqual({
      query: "合同解除的法定情形",
      wenshu_filter: {},
      top_k: 10,
    });
  });

  it("env overrides the tool names", () => {
    process.env.LAWMIND_YUANDIAN_LAW_TOOL = "yuandian_rh_fg_search";
    expect(resolveYuandianTools().law).toBe("yuandian_rh_fg_search");
    expect(resolveYuandianTools().case).toBe("yuandian_rh_ptal_search");
  });
});
