import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { parseProbeErrorBody as engineParseProbeErrorBody } from "../../../src/lawmind/models/probe.js";

const require = createRequire(import.meta.url);
const { probeModelInline, parseProbeErrorBody: mirrorParseProbeErrorBody } =
  require("./lawmind-model-probe.cjs") as {
    probeModelInline: (config: {
      apiKey: string;
      baseUrl: string;
      model: string;
      timeoutMs?: number;
    }) => Promise<
      { ok: true; latencyMs: number } | { ok: false; code: string; error: string }
    >;
    parseProbeErrorBody: (raw: string) => string | null;
  };

/**
 * 模型探活有两份实现：引擎的 `src/lawmind/models/probe.ts`（桌面后端起进程内用）
 * 与 Electron 主进程的 `lawmind-model-probe.cjs` 镜像（写入前预检用，主进程是 .mjs
 * import 不了 TS）。
 *
 * 这份测试替代了原来的 `lawmind-model-probe.test.cjs`——那个文件用 `node:test` 写，
 * 而 vitest 的 include 只收 `electron/**\/*.test.ts`，所以它**从来没有被执行过**
 * （跑 `node --test` 也没人调）。镜像的「Keep in sync」注释当时只靠人读。
 *
 * 这里只守卫**语义必须一致**的那部分（`parseProbeErrorBody`）；镜像整体是引擎探活的
 * 简化版，错误码/文案刻意更少，不做全量行为对齐断言。
 */
describe("lawmind-model-probe mirror", () => {
  it("rejects a missing api key before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const result = await probeModelInline({
        apiKey: "",
        baseUrl: "https://example.com/v1",
        model: "test",
      });
      expect(result).toMatchObject({ ok: false, code: "missing_api_key" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an incomplete config before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const result = await probeModelInline({ apiKey: "k", baseUrl: "", model: "test" });
      expect(result).toMatchObject({ ok: false, code: "invalid_config" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("probes OpenAI-compatible /chat/completions with the bearer key", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const result = await probeModelInline({
        apiKey: "sk-test",
        baseUrl: "https://api.example.com/v1/",
        model: "some-model",
      });
      expect(result.ok).toBe(true);
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      // 末尾斜杠必须被吃掉，否则会拼出 `//chat/completions`
      expect(url).toBe("https://api.example.com/v1/chat/completions");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
      expect(JSON.parse(typeof init.body === "string" ? init.body : "")).toMatchObject({
        model: "some-model",
        max_tokens: 8,
        temperature: 0,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies HTTP 401 as an invalid key instead of a raw body", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Incorrect API key provided: sk-secret" } }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const result = await probeModelInline({
        apiKey: "sk-secret",
        baseUrl: "https://api.example.com/v1",
        model: "some-model",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_api_key");
        expect(result.error).toContain("密钥无效或已过期");
        expect(result.error).not.toContain("sk-secret");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies HTTP 200 bodies that carry an error payload", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: { message: "model not found" } }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const result = await probeModelInline({
        apiKey: "sk-test",
        baseUrl: "https://api.example.com/v1",
        model: "nope",
      });
      expect(result).toMatchObject({ ok: false, code: "model_api_error", error: "model not found" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("parses error bodies identically to the engine probe", () => {
    // 语料覆盖两边的每个分支：error 为字符串 / 对象 message / 对象 msg、无 error 且
    // 无 choices、非 JSON、空串、choices 合法。任何一边改了规则，这里必然分歧。
    const corpus = [
      JSON.stringify({ error: "plain string error" }),
      JSON.stringify({ error: { message: "nested message" } }),
      JSON.stringify({ error: { msg: "nested msg" } }),
      JSON.stringify({ error: { message: "   " } }),
      JSON.stringify({ error: {} }),
      JSON.stringify({ choices: [] }),
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      JSON.stringify({}),
      JSON.stringify({ error: { message: "x".repeat(500) } }),
      "not json at all",
      "  ",
      "",
    ];
    const mismatches = corpus.filter(
      (raw) => mirrorParseProbeErrorBody(raw) !== engineParseProbeErrorBody(raw),
    );
    expect(mismatches).toEqual([]);

    // 防呆：语料必须同时含有命中和不命中的样本，否则「两边都恒返回同一值」也会通过。
    const hits = corpus.filter((raw) => engineParseProbeErrorBody(raw) !== null).length;
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(corpus.length);
  });
});
