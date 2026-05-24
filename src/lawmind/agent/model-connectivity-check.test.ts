import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildModelConnectivityCheckReply,
  isModelConnectivityCheckQuestion,
} from "./model-connectivity-check.js";

const IDENTITY = {
  catalogLabel: "API 向导 · qwen3.6-plus",
  providerLabel: "OpenAI 兼容 API",
  upstreamModel: "qwen3.6-plus",
  catalogId: "env:current",
};

describe("model-connectivity-check", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects chain verification questions", () => {
    expect(
      isModelConnectivityCheckQuestion("你确定你可以调用qwen3.6-plus API吗？请完整检查这个链路"),
    ).toBe(true);
    expect(isModelConnectivityCheckQuestion("请测试当前模型 API 连接")).toBe(true);
    expect(isModelConnectivityCheckQuestion("你是什么模型")).toBe(false);
  });

  it("reports probe success with latency", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "ok" } }],
          }),
      })),
    );
    const reply = await buildModelConnectivityCheckReply({
      identity: IDENTITY,
      modelConfig: {
        provider: "openai-compatible",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-test",
        model: "qwen3.6-plus",
        timeoutMs: 30_000,
      },
      lawMindRoot: "/tmp/unused",
    });
    expect(reply).toContain("可以调用");
    expect(reply).toContain("qwen3.6-plus");
    expect(reply).toContain("AbortError");
  });

  it("reports missing api key without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const reply = await buildModelConnectivityCheckReply({
      identity: IDENTITY,
      modelConfig: {
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "",
        model: "qwen3.6-plus",
      },
      lawMindRoot: "/tmp/unused",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reply).toContain("无法调用");
    expect(reply).toContain("未配置");
  });
});
