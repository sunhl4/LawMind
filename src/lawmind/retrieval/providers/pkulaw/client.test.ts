import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { pkulawRetrieve } from "./client.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const lawFixture = readFileSync(path.join(HERE, "fixtures/law-search-hits.json"), "utf8");
const caseFixture = readFileSync(path.join(HERE, "fixtures/case-search-hits.json"), "utf8");

describe("pkulawRetrieve", () => {
  it.each([
    [
      { result: { isError: true, content: [{ type: "text", text: "积分不足，请充值" }] } },
      "quota_exhausted",
    ],
    [{ error: { code: 402, message: "insufficient credits" } }, "quota_exhausted"],
    [
      { result: { content: [{ type: "text", text: '{"code":402,"message":"余额不足"}' }] } },
      "quota_exhausted",
    ],
    [
      { result: { content: [{ type: "text", text: "积分已耗尽" }], isError: false } },
      "quota_exhausted",
    ],
    [
      { result: { isError: true, content: [{ type: "text", text: "invalid token" }] } },
      "unauthorized",
    ],
    [{ result: { content: [{ type: "text", text: "[]" }] } }, "empty"],
    [{ hits: [] }, "empty"],
    [{ result: { unexpected: true } }, "invalid_response"],
    [{ hits: [{ unexpected: true }] }, "invalid_response"],
  ])("distinguishes HTTP 200 provider outcomes: %j", async (body, status) => {
    const fetchImpl = vi.fn(async () => Response.json(body));
    const { result } = await pkulawRetrieve({
      endpointNormalized: "https://authority.example/pkulaw",
      query: "法规",
      mode: "mcp_tools_call",
      fetchImpl,
    });
    expect(result.authorityOutcome).toEqual({ status, httpStatus: 200, hitCount: 0 });
    expect(result.sources).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not mistake quota wording in a real statute for an account error", async () => {
    const { result } = await pkulawRetrieve({
      endpointNormalized: "https://authority.example/pkulaw",
      query: "配额",
      mode: "rest_compat",
      fetchImpl: async () =>
        Response.json({
          hits: [{ title: "配额不足的处理规定", excerpt: "配额不足时的法定义务", id: "q1" }],
        }),
    });
    expect(result.authorityOutcome?.status).toBe("ok");
    expect(result.sources).toHaveLength(1);
  });

  it("classifies invalid JSON and network failure without exposing response text", async () => {
    for (const [fetchImpl, status] of [
      [async () => new Response("not-json secret-token"), "invalid_response"],
      [
        async () => {
          throw new Error("network secret-token");
        },
        "unavailable",
      ],
    ] as const) {
      const { result } = await pkulawRetrieve({
        endpointNormalized: "https://authority.example/pkulaw",
        query: "法规",
        mode: "rest_compat",
        fetchImpl,
      });
      expect(result.authorityOutcome?.status).toBe(status);
      expect(JSON.stringify(result)).not.toContain("secret-token");
    }
  });
  it("uses MCP tools/call for the official 法宝 gateway when mode is unset", async () => {
    const prev = process.env.LAWMIND_PKULAW_MODE;
    delete process.env.LAWMIND_PKULAW_MODE;
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { content: [{ type: "text", text: "[]" }] },
          }),
          { status: 200 },
        ),
    );
    try {
      await pkulawRetrieve({
        endpointNormalized: "https://apim-gateway.pkulaw.com/mcp-law-search-service",
        query: "出口管制",
        apiKey: "tok-test",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const init = fetchImpl.mock.calls[0]?.[1] as { method?: string; body?: string };
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body)).method).toBe("tools/call");
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_PKULAW_MODE;
      } else {
        process.env.LAWMIND_PKULAW_MODE = prev;
      }
    }
  });

  it("rest_compat maps law fixture and sends Bearer", async () => {
    const fetchImpl = vi.fn(async () => new Response(lawFixture, { status: 200 }));
    const { result, httpStatus } = await pkulawRetrieve({
      endpointNormalized: "https://authority.example/pkulaw",
      query: "民法典 解除",
      apiKey: "tok-test",
      mode: "rest_compat",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(httpStatus).toBe(200);
    expect(result.sources).toHaveLength(1);
    expect(result.claims[0]?.sourceIds).toEqual(["pkulaw-stat-563"]);
    const init = fetchImpl.mock.calls[0]?.[1] as { headers?: Record<string, string> };
    expect(init.headers?.authorization).toBe("Bearer tok-test");
  });

  it("search_post maps case fixture", async () => {
    const fetchImpl = vi.fn(async () => new Response(caseFixture, { status: 200 }));
    const { result } = await pkulawRetrieve({
      endpointNormalized: "https://authority.example/pkulaw/search",
      query: "类案 押金返还",
      mode: "search_post",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.sources[0]?.kind).toBe("case");
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}")) as {
      searchType?: string;
    };
    expect(body.searchType).toBe("case");
  });

  it("maps 401 to auth missingItems", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const { result } = await pkulawRetrieve({
      endpointNormalized: "https://authority.example/pkulaw",
      query: "法条",
      mode: "rest_compat",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.sources).toEqual([]);
    expect(result.missingItems.some((m) => m.includes("鉴权"))).toBe(true);
  });

  it("mcp_tools_call unwraps content JSON", async () => {
    const inner = JSON.parse(lawFixture) as unknown;
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: {
          content: [{ type: "text", text: JSON.stringify(inner) }],
        },
      }),
    );
    const { result } = await pkulawRetrieve({
      endpointNormalized: "https://apim-gateway.example/mcp",
      query: "民法典",
      mode: "mcp_tools_call",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.sources).toHaveLength(1);
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}")) as {
      params?: { name?: string; arguments?: { text?: string; query?: string; size?: number } };
    };
    expect(sent.params?.name).toBe("search_article");
    expect(sent.params?.arguments?.text).toBe("民法典");
    expect(sent.params?.arguments?.query).toBeUndefined();
    expect(sent.params?.arguments?.size).toBe(10);
  });

  it("searchKind case overrides a law-looking query", async () => {
    const prevCase = process.env.LAWMIND_PKULAW_CASE_ENDPOINT;
    process.env.LAWMIND_PKULAW_CASE_ENDPOINT = "https://apim-gateway.example/mcp-case";
    try {
      const fetchImpl = vi.fn(async () => new Response(caseFixture, { status: 200 }));
      await pkulawRetrieve({
        endpointNormalized: "https://apim-gateway.example/mcp-law",
        query: "劳动合同解除",
        mode: "mcp_tools_call",
        searchKind: "case",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://apim-gateway.example/mcp-case");
      const sent = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}")) as {
        params?: { name?: string };
      };
      expect(sent.params?.name).toBe("search_case");
    } finally {
      if (prevCase === undefined) {
        delete process.env.LAWMIND_PKULAW_CASE_ENDPOINT;
      } else {
        process.env.LAWMIND_PKULAW_CASE_ENDPOINT = prevCase;
      }
    }
  });

  it("mcp_tools_call maps official structuredContent and uses case endpoint", async () => {
    const official = readFileSync(path.join(HERE, "fixtures/official-search-article.json"), "utf8");
    const prevCase = process.env.LAWMIND_PKULAW_CASE_ENDPOINT;
    process.env.LAWMIND_PKULAW_CASE_ENDPOINT = "https://apim-gateway.example/mcp-case";
    try {
      const fetchImpl = vi.fn(async () => new Response(official, { status: 200 }));
      const { result } = await pkulawRetrieve({
        endpointNormalized: "https://apim-gateway.example/mcp-law",
        query: "类案 押金返还",
        mode: "mcp_tools_call",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://apim-gateway.example/mcp-case");
      const sent = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}")) as {
        params?: { name?: string };
      };
      expect(sent.params?.name).toBe("search_case");
      expect(result.sources[0]?.id).toBe("gid-labor-36");
    } finally {
      if (prevCase === undefined) {
        delete process.env.LAWMIND_PKULAW_CASE_ENDPOINT;
      } else {
        process.env.LAWMIND_PKULAW_CASE_ENDPOINT = prevCase;
      }
    }
  });

  it("mcp_tools_call maps official case structuredContent.data (real gateway shape)", async () => {
    const officialCase = readFileSync(
      path.join(HERE, "fixtures/official-search-case.json"),
      "utf8",
    );
    const prevCase = process.env.LAWMIND_PKULAW_CASE_ENDPOINT;
    process.env.LAWMIND_PKULAW_CASE_ENDPOINT = "https://apim-gateway.example/mcp-case";
    try {
      const fetchImpl = vi.fn(async () => new Response(officialCase, { status: 200 }));
      const { result } = await pkulawRetrieve({
        endpointNormalized: "https://apim-gateway.example/mcp-law",
        query: "劳动合同 违法解除",
        mode: "mcp_tools_call",
        // 显式走类案通道：不指定时该查询会被推成 laws，类案端点根本没被请求。
        searchKind: "case",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("mcp-case");
      // 真实网关把类案放在结构化 data[]，此前完全没被采集 → invalid_response。
      expect(result.authorityOutcome?.status).toBe("ok");
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0]?.kind).toBe("case");
      expect(result.sources[0]?.citation).toBe("(2016)津02民终619号");
      expect(result.sources[0]?.url).toContain("pkulaw.com/pfnl/");
      expect(result.sources[0]?.excerpt).toContain("本院认为");
      expect(result.claims.length).toBe(2);
    } finally {
      if (prevCase === undefined) {
        delete process.env.LAWMIND_PKULAW_CASE_ENDPOINT;
      } else {
        process.env.LAWMIND_PKULAW_CASE_ENDPOINT = prevCase;
      }
    }
  });

  it("official case gateway zero hits is empty, not invalid_response", async () => {
    const emptyCase = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ text: "未检索到匹配的司法案例。", type: "text" }],
        isError: false,
        structuredContent: { data: [] },
      },
    });
    const prevCase = process.env.LAWMIND_PKULAW_CASE_ENDPOINT;
    process.env.LAWMIND_PKULAW_CASE_ENDPOINT = "https://apim-gateway.example/mcp-case";
    try {
      const fetchImpl = vi.fn(async () => new Response(emptyCase, { status: 200 }));
      const { result } = await pkulawRetrieve({
        endpointNormalized: "https://apim-gateway.example/mcp-law",
        query: "（2021）京01民终1234号",
        mode: "mcp_tools_call",
        searchKind: "case",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(result.authorityOutcome?.status).toBe("empty");
      expect(result.sources).toHaveLength(0);
    } finally {
      if (prevCase === undefined) {
        delete process.env.LAWMIND_PKULAW_CASE_ENDPOINT;
      } else {
        process.env.LAWMIND_PKULAW_CASE_ENDPOINT = prevCase;
      }
    }
  });

  it("runs two 法宝 searches at the same time", async () => {
    let inFlight = 0;
    let max = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inFlight -= 1;
      return new Response(lawFixture, { status: 200 });
    });
    await Promise.all([
      pkulawRetrieve({
        endpointNormalized: "https://authority.example/pkulaw",
        query: "未成年人保护法",
        apiKey: "tok-test",
        mode: "rest_compat",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
      pkulawRetrieve({
        endpointNormalized: "https://authority.example/pkulaw",
        query: "劳动合同法",
        apiKey: "tok-test",
        mode: "rest_compat",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ]);
    expect(max).toBe(2);
  });
});
