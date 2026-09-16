import { describe, expect, it, vi } from "vitest";
import {
  detectNativeWebSearchKind,
  extractNativeWebHits,
  originWithoutV1,
  runNativeWebSearch,
} from "./native-web-search.js";

vi.mock("../../llm/http-retry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../llm/http-retry.js")>();
  return { ...actual, waitModelRetry: async () => undefined };
});

describe("native-web-search", () => {
  it("detects DeepSeek Flash on the official host", () => {
    expect(detectNativeWebSearchKind("https://api.deepseek.com/v1", "deepseek-flash")).toBe(
      "deepseek-responses",
    );
    expect(detectNativeWebSearchKind("https://api.deepseek.com", "deepseek-v4-flash")).toBe(
      "deepseek-responses",
    );
  });

  it("does not treat a random model on DeepSeek's default URL as native search", () => {
    expect(detectNativeWebSearchKind("https://api.deepseek.com/v1", "test-model")).toBeNull();
  });

  it("detects Qwen on DashScope", () => {
    expect(
      detectNativeWebSearchKind("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
    ).toBe("dashscope-enable-search");
  });

  it("strips /v1 for the Responses origin", () => {
    expect(originWithoutV1("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com");
  });

  it("extracts url_citation annotations and ignores the model API host", () => {
    const hits = extractNativeWebHits(
      {
        output: [
          {
            type: "web_search_call",
            action: { type: "search", query: "2026 新说唱" },
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "公开报道见 [节目页](https://example.com/show)",
                annotations: [
                  {
                    type: "url_citation",
                    title: "节目页",
                    url: "https://example.com/show",
                  },
                ],
              },
            ],
          },
        ],
      },
      8,
    );
    expect(hits).toEqual([
      {
        title: "节目页",
        url: "https://example.com/show",
        description: "",
      },
    ]);
  });

  it("extracts DashScope search_info URLs", () => {
    const hits = extractNativeWebHits(
      {
        choices: [{ message: { content: "见检索结果" } }],
        search_info: {
          search_results: [{ title: "报道", url: "https://news.example.com/a", snippet: "摘要" }],
        },
      },
      5,
    );
    expect(hits[0]).toEqual({
      title: "报道",
      url: "https://news.example.com/a",
      description: "摘要",
    });
  });

  it("retries DeepSeek HTTP 503 then returns hits", async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("busy", { status: 503 });
      }
      return Response.json({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "见 [节目页](https://example.com/show)",
                annotations: [
                  { type: "url_citation", title: "节目页", url: "https://example.com/show" },
                ],
              },
            ],
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await runNativeWebSearch(
        { baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "deepseek-flash" },
        "query",
        5,
      );
      expect(out.kind).toBe("deepseek-responses");
      expect(out.results[0]?.url).toBe("https://example.com/show");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls through a DeepSeek 400 to the next model name without burning retries", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      if (body.model === "deepseek-flash") {
        return new Response("unknown model", { status: 400 });
      }
      return Response.json({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                annotations: [
                  { type: "url_citation", title: "报道", url: "https://news.example.com/a" },
                ],
              },
            ],
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await runNativeWebSearch(
        { baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "deepseek-flash" },
        "query",
        5,
      );
      expect(out.results[0]?.url).toBe("https://news.example.com/a");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not treat an honest empty result as EMPTY_RESPONSE", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        output: [{ type: "message", content: [{ type: "output_text", text: "没有检索到" }] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await runNativeWebSearch(
        { baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "deepseek-chat" },
        "query",
        5,
      );
      expect(out.results).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
