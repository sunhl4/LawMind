/**
 * Model router tests (fetch mocked).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeAsync } from "./index.js";
import { readRouteDivergenceRecords, routeDivergencePath } from "./route-divergence.js";

describe("routeAsync model router", () => {
  const prev = { ...process.env };
  const dirs: string[] = [];

  function clearAgentEnv(): void {
    delete process.env.LAWMIND_ROUTER_MODE;
    delete process.env.LAWMIND_ROUTER_BASE_URL;
    delete process.env.LAWMIND_ROUTER_API_KEY;
    delete process.env.LAWMIND_ROUTER_MODEL;
    delete process.env.LAWMIND_AGENT_BASE_URL;
    delete process.env.LAWMIND_AGENT_API_KEY;
    delete process.env.LAWMIND_AGENT_MODEL;
    delete process.env.QWEN_BASE_URL;
    delete process.env.QWEN_API_KEY;
    delete process.env.QWEN_MODEL;
    delete process.env.LAWMIND_ROUTE_DIVERGENCE;
    delete process.env.LAWMIND_WORKSPACE_DIR;
  }

  beforeEach(() => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: "research.legal",
                summary: "检索民法典违约责任条款",
                riskLevel: "medium",
                models: ["legal"],
                requiresConfirmation: false,
                output: "markdown",
              }),
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", mockFetch);
  });

  /** 覆盖 mock 模型返回的分类（用于构造「三路径一致」这类需要特定口径的用例）。 */
  function stubModelRoute(payload: Record<string, unknown>): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(payload) } }],
        }),
      })),
    );
  }

  afterEach(() => {
    process.env = { ...prev };
    vi.unstubAllGlobals();
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("uses keyword route when credentials are missing", async () => {
    clearAgentEnv();
    const intent = await routeAsync({ instruction: "写一封催款律师函" });
    expect(intent.kind).toBe("draft.word");
    expect(vi.mocked(fetch).mock.calls.length).toBe(0);
  });

  it("uses keyword route when LAWMIND_ROUTER_MODE=keyword even with credentials", async () => {
    clearAgentEnv();
    process.env.LAWMIND_ROUTER_MODE = "keyword";
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";

    const intent = await routeAsync({ instruction: "写一封催款律师函" });
    expect(intent.kind).toBe("draft.word");
    expect(vi.mocked(fetch).mock.calls.length).toBe(0);
  });

  it("calls LLM when credentials exist and mode is unset", async () => {
    clearAgentEnv();
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";

    const intent = await routeAsync({ instruction: "查一下违约责任" });
    expect(intent.kind).toBe("research.legal");
    expect(intent.summary).toContain("检索");
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("calls LLM when LAWMIND_ROUTER_MODE=model and credentials exist", async () => {
    clearAgentEnv();
    process.env.LAWMIND_ROUTER_MODE = "model";
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";

    const intent = await routeAsync({ instruction: "查一下违约责任" });
    expect(intent.kind).toBe("research.legal");
    expect(intent.summary).toContain("检索");
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("P2.3：shadow 记录分歧但**不改变返回值**（返回模型口径）", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ra-"));
    dirs.push(ws);
    process.env.LAWMIND_WORKSPACE_DIR = ws;
    clearAgentEnv();
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";

    // 原话命中关键词 draft.word，但 mock 模型返回 research.legal → kind 分歧
    const intent = await routeAsync({ instruction: "起草一份催款律师函", lawMindRoot: ws });
    // ① 行为不变：仍返回模型的口径
    expect(intent.kind).toBe("research.legal");

    // ② 分歧被记录
    const read = readRouteDivergenceRecords(ws);
    expect(read.present).toBe(true);
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]?.kindAgreement).toBe(false);
    expect(read.rows[0]?.kinds).toEqual(["draft.word", "research.legal"]);
  });

  it("P2.3：LAWMIND_ROUTE_DIVERGENCE=0 时零写入", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ra-off-"));
    dirs.push(ws);
    clearAgentEnv();
    process.env.LAWMIND_ROUTE_DIVERGENCE = "0";
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";

    await routeAsync({ instruction: "起草一份催款律师函", lawMindRoot: ws });
    expect(readRouteDivergenceRecords(ws).present).toBe(false);
    expect(fs.existsSync(routeDivergencePath(ws))).toBe(false);
  });

  it("P2.3：无 lawMindRoot 时不写（不猜工作区位置）", async () => {
    clearAgentEnv();
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";
    // 不应抛
    const intent = await routeAsync({ instruction: "起草催款律师函" });
    expect(intent.kind).toBe("research.legal");
  });

  it("P2.4：默认 shadow —— 有分歧但**不改** requiresConfirmation", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ra-sh-"));
    dirs.push(ws);
    clearAgentEnv();
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";

    // 原话命中关键词 draft.word（high risk），模型回 research.legal
    const intent = await routeAsync({ instruction: "起草一份催款律师函", lawMindRoot: ws });
    expect(readRouteDivergenceRecords(ws).rows[0]?.kindAgreement).toBe(false);
    // shadow：分歧被记录，但返回值与分歧无关
    expect(intent.kind).toBe("research.legal");
    expect(intent.requiresConfirmation).toBe(false);
  });

  it("P2.4：posture=escalate —— 分歧经既有 requiresConfirmation 通道升级", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ra-esc-"));
    dirs.push(ws);
    clearAgentEnv();
    process.env.LAWMIND_ROUTE_DIVERGENCE_POSTURE = "escalate";
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";

    const intent = await routeAsync({ instruction: "起草一份催款律师函", lawMindRoot: ws });
    // 口径仍是模型判的那个（不替律师选路），但要求确认
    expect(intent.kind).toBe("research.legal");
    expect(intent.requiresConfirmation).toBe(true);
  });

  it("P2.4：posture=escalate 但三路径完全一致 → 不升级", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ra-agree-"));
    dirs.push(ws);
    clearAgentEnv();
    process.env.LAWMIND_ROUTE_DIVERGENCE_POSTURE = "escalate";
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";
    // 让三条路径真正一致：关键词 research.hybrid/low + 分诊 green/low + 模型 low
    stubModelRoute({
      kind: "research.hybrid",
      summary: "检索整理",
      riskLevel: "low",
      models: ["general"],
      requiresConfirmation: false,
      output: "markdown",
    });

    const intent = await routeAsync({ instruction: "检索一下", lawMindRoot: ws });
    expect(intent.kind).toBe("research.hybrid");
    expect(intent.requiresConfirmation).toBe(false);
    expect(readRouteDivergenceRecords(ws).rows[0]?.kindAgreement).toBe(true);
    expect(readRouteDivergenceRecords(ws).rows[0]?.riskAgreement).toBe(true);
  });

  it("真实发现：分诊 tier 与路由 riskLevel 是**不同的概念**，因此风险档经常分歧", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ra-risk-"));
    dirs.push(ws);
    clearAgentEnv();
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";

    // "查一下违约责任"：关键词→research.legal(medium)、模型→research.legal(medium)，
    // 但分诊 simple-green→low。kind 一致而 risk 不一致。
    const intent = await routeAsync({ instruction: "查一下违约责任", lawMindRoot: ws });
    expect(intent.kind).toBe("research.legal");

    const rec = readRouteDivergenceRecords(ws).rows[0];
    expect(rec.kindAgreement).toBe(true);
    expect(rec.riskAgreement).toBe(false);
    expect(rec.riskLevels).toEqual(["low", "medium"]);
    // 这不是 bug，而是「分诊档位」与「风险档」本就不同义 —— shadow 数据的价值就在这里：
    // 它让这种概念层不一致变成可计数的对象，而不是埋在代码里的隐性假设。
  });
});
