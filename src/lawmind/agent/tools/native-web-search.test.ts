import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * Loopback DeepSeek Responses cassette. The outbound proxy bypasses global
 * fetch (DNS pinning), so tests script real HTTP over 127.0.0.1; the model
 * name still drives native-kind detection.
 */
type StubRound = { status?: number; body: unknown };

type ResponsesStubServer = {
  baseUrl: string;
  requests: Array<{ rawBody: string }>;
  enqueue: (...rounds: StubRound[]) => void;
  close: () => Promise<void>;
};

async function startResponsesStub(): Promise<ResponsesStubServer> {
  const queue: StubRound[] = [];
  const requests: Array<{ rawBody: string }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      requests.push({ rawBody: raw });
      const round = queue.shift();
      if (!round) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "cassette exhausted" }));
        return;
      }
      res.writeHead(round.status ?? 200, { "Content-Type": "application/json" });
      res.end(typeof round.body === "string" ? round.body : JSON.stringify(round.body));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    enqueue: (...rounds) => {
      queue.push(...rounds);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const servers: ResponsesStubServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function startServer(): Promise<ResponsesStubServer> {
  const server = await startResponsesStub();
  servers.push(server);
  return server;
}

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
    const server = await startServer();
    server.enqueue(
      { status: 503, body: "busy" },
      {
        body: {
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
        },
      },
    );
    const out = await runNativeWebSearch(
      { baseUrl: server.baseUrl, apiKey: "k", model: "deepseek-flash" },
      "query",
      5,
    );
    expect(out.kind).toBe("deepseek-responses");
    expect(out.results[0]?.url).toBe("https://example.com/show");
    expect(server.requests).toHaveLength(2);
  });

  it("falls through a DeepSeek 400 to the next model name without burning retries", async () => {
    const server = await startServer();
    server.enqueue(
      { status: 400, body: "unknown model" },
      {
        body: {
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
        },
      },
    );
    const out = await runNativeWebSearch(
      { baseUrl: server.baseUrl, apiKey: "k", model: "deepseek-flash" },
      "query",
      5,
    );
    expect(out.results[0]?.url).toBe("https://news.example.com/a");
    expect(server.requests).toHaveLength(2);
    // 第一次用 deepseek-flash 被拒，第二次落到别名 deepseek-v4-flash。
    const models = server.requests.map((r) => (JSON.parse(r.rawBody) as { model?: string }).model);
    expect(models).toEqual(["deepseek-flash", "deepseek-v4-flash"]);
  });

  it("does not treat an honest empty result as EMPTY_RESPONSE", async () => {
    const server = await startServer();
    server.enqueue({
      body: {
        output: [{ type: "message", content: [{ type: "output_text", text: "没有检索到" }] }],
      },
    });
    const out = await runNativeWebSearch(
      { baseUrl: server.baseUrl, apiKey: "k", model: "deepseek-chat" },
      "query",
      5,
    );
    expect(out.results).toEqual([]);
    expect(server.requests).toHaveLength(1);
  });
});
