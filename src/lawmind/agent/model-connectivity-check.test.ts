import { describe, expect, it, afterEach } from "vitest";
import {
  buildModelConnectivityCheckReply,
  isModelConnectivityCheckQuestion,
} from "./model-connectivity-check.js";
import {
  cassetteAssistant,
  startCassetteModelServer,
  type CassetteModelServer,
} from "./testkit/index.js";

const IDENTITY = {
  catalogLabel: "主模型 · qwen3.6-plus",
  providerLabel: "OpenAI 兼容 API",
  upstreamModel: "qwen3.6-plus",
  catalogId: "env:current",
};

describe("model-connectivity-check", () => {
  const servers: CassetteModelServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it("detects chain verification questions", () => {
    expect(
      isModelConnectivityCheckQuestion("你确定你可以调用qwen3.6-plus API吗？请完整检查这个链路"),
    ).toBe(true);
    expect(isModelConnectivityCheckQuestion("请测试当前模型 API 连接")).toBe(true);
    expect(isModelConnectivityCheckQuestion("你是什么模型")).toBe(false);
  });

  it("reports probe success with latency", async () => {
    // Loopback cassette：探测走出口代理（绕过 global fetch），脚本化本机 HTTP 响应。
    const server = await startCassetteModelServer();
    servers.push(server);
    server.enqueue(cassetteAssistant("ok"));
    const reply = await buildModelConnectivityCheckReply({
      identity: IDENTITY,
      modelConfig: {
        provider: "openai-compatible",
        baseUrl: server.url,
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
    const server = await startCassetteModelServer();
    servers.push(server);
    const reply = await buildModelConnectivityCheckReply({
      identity: IDENTITY,
      modelConfig: {
        provider: "openai-compatible",
        baseUrl: server.url,
        apiKey: "",
        model: "qwen3.6-plus",
      },
      lawMindRoot: "/tmp/unused",
    });
    expect(server.requests).toHaveLength(0);
    expect(reply).toContain("无法调用");
    expect(reply).toContain("未配置");
  });
});
