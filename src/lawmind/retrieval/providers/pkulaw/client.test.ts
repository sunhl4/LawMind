import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { pkulawRetrieve } from "./client.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const lawFixture = readFileSync(path.join(HERE, "fixtures/law-search-hits.json"), "utf8");
const caseFixture = readFileSync(path.join(HERE, "fixtures/case-search-hits.json"), "utf8");

describe("pkulawRetrieve", () => {
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
});
