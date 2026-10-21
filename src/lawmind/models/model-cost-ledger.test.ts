/**
 * 成本账：能说出「一次调用用了多少、缓存中了多少、重试花了多少」。
 *
 * 旧账本只有 prompt/completion/total 三个数，且只记成功回合的汇总，
 * 于是 BYOK 用户问「这份审查花了多少」时答不出来 —— 卖点正好落空。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dropSupersededRollupRows,
  mergeUsageSnapshots,
  recordModelUsage,
  summarizeModelUsage,
  usageFromProvider,
} from "./model-usage.js";
import { providerCapabilities, resolveProviderCapabilities } from "./provider-capabilities.js";
import {
  estimateToolSchemaTokens,
  toolTableFingerprint,
  ToolTableMeter,
} from "./tool-table-fingerprint.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-usage-ledger-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("usageFromProvider keeps cache fields", () => {
  it("reads DeepSeek's prompt_cache_hit_tokens", () => {
    const snapshot = usageFromProvider({
      prompt_tokens: 50_988,
      completion_tokens: 150,
      total_tokens: 51_138,
      prompt_cache_hit_tokens: 50_688,
      prompt_cache_miss_tokens: 300,
    });
    expect(snapshot?.cachedTokens).toBe(50_688);
    expect(snapshot?.uncachedTokens).toBe(300);
  });

  it("reads OpenAI's prompt_tokens_details.cached_tokens and derives the miss count", () => {
    const snapshot = usageFromProvider({
      prompt_tokens: 1_000,
      completion_tokens: 100,
      total_tokens: 1_100,
      prompt_tokens_details: { cached_tokens: 900 },
      completion_tokens_details: { reasoning_tokens: 40 },
    });
    expect(snapshot?.cachedTokens).toBe(900);
    expect(snapshot?.uncachedTokens).toBe(100);
    expect(snapshot?.reasoningTokens).toBe(40);
  });

  it("leaves cache unknown (not zero) when the provider reports nothing", () => {
    const snapshot = usageFromProvider({ prompt_tokens: 100, completion_tokens: 10 });
    expect(snapshot?.cachedTokens).toBeUndefined();
    expect(snapshot?.uncachedTokens).toBeUndefined();
  });

  it("leaves aggregate cache unknown if any attempt lacks cache usage", () => {
    const merged = mergeUsageSnapshots(
      { promptTokens: 100, completionTokens: 10, totalTokens: 110, cachedTokens: 80 },
      { promptTokens: 200, completionTokens: 20, totalTokens: 220 },
    );
    expect(merged?.cachedTokens).toBeUndefined();
    expect(merged?.promptTokens).toBe(300);
  });
});

describe("ledger keeps per-call rows with cache and billing scope", () => {
  it("worker rows cannot erase the parent rollup and billing scopes stay separate", () => {
    const ws = tmp();
    recordModelUsage(ws, {
      sessionId: "s",
      turnId: "t",
      purpose: "turn_rollup",
      promptTokens: 100,
      completionTokens: 0,
      totalTokens: 100,
      billingScope: "byok",
    });
    recordModelUsage(ws, {
      sessionId: "s",
      turnId: "t",
      purpose: "worker",
      attempt: 1,
      promptTokens: 10,
      completionTokens: 0,
      totalTokens: 10,
      billingScope: "subscription",
    });
    const summary = summarizeModelUsage(ws);
    expect(summary.totalTokens).toBe(110);
    expect(summary.byBillingScope).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ billingScope: "byok", totalTokens: 100 }),
        expect.objectContaining({ billingScope: "subscription", totalTokens: 10 }),
      ]),
    );
  });

  it("records partial and missing usage as unknown rather than a zero-token request", () => {
    expect(usageFromProvider({ completion_tokens: 7 })).toMatchObject({ completionTokens: 7 });
    expect(usageFromProvider({ completion_tokens: 7 })?.promptTokens).toBeUndefined();
    expect(usageFromProvider({ completion_tokens: 7 })?.totalTokens).toBeUndefined();
    const ws = tmp();
    recordModelUsage(ws, { attempt: 1, failed: true, billingScope: "byok" });
    const row = JSON.parse(fs.readFileSync(path.join(ws, "model-usage", "ledger.jsonl"), "utf8"));
    expect(row).not.toHaveProperty("promptTokens");
    expect(summarizeModelUsage(ws).unknownUsageEntries).toBe(1);
  });

  it("writes and reads back optional fields", () => {
    const ws = tmp();
    recordModelUsage(ws, {
      sessionId: "s1",
      turnId: "t1",
      model: "deepseek-flash",
      provider: "deepseek",
      attempt: 1,
      purpose: "parent_turn",
      promptTokens: 50_988,
      completionTokens: 150,
      totalTokens: 51_138,
      cachedTokens: 50_688,
      uncachedTokens: 300,
      latencyMs: 1_234,
      billingScope: "byok",
      fixedInputTokens: 67_864,
      toolTableFingerprint: "abc123",
    });
    const summary = summarizeModelUsage(ws, { sinceDays: 1 });
    expect(summary.entries).toBe(1);
    expect(summary.totalTokens).toBe(51_138);
  });

  it("does not double count a turn that has both per-call rows and a rollup row", () => {
    const entries = [
      {
        id: "a",
        recordedAt: new Date().toISOString(),
        turnId: "t1",
        attempt: 1,
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
      },
      {
        id: "b",
        recordedAt: new Date().toISOString(),
        turnId: "t1",
        purpose: "turn_rollup",
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
      },
    ];
    expect(dropSupersededRollupRows(entries).map((e) => e.id)).toEqual(["a"]);
  });

  it("keeps a legacy rollup-only turn in the totals", () => {
    const entries = [
      {
        id: "legacy",
        recordedAt: new Date().toISOString(),
        turnId: "t9",
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
      },
    ];
    expect(dropSupersededRollupRows(entries).map((e) => e.id)).toEqual(["legacy"]);
  });

  it("counts failed attempts too (a failed turn still costs retries)", () => {
    const ws = tmp();
    recordModelUsage(ws, {
      turnId: "t1",
      attempt: 1,
      failed: true,
      errorKind: "timeout",
      billingScope: "byok",
    });
    recordModelUsage(ws, {
      turnId: "t1",
      attempt: 2,
      promptTokens: 500,
      completionTokens: 50,
      totalTokens: 550,
      billingScope: "byok",
    });
    const summary = summarizeModelUsage(ws, { sinceDays: 1 });
    expect(summary.entries).toBe(2);
  });
});

describe("tool table meter", () => {
  it("fingerprints identical tool tables identically, and different ones differently", () => {
    const a = [{ type: "function", function: { name: "search_statute", description: "x" } }];
    const b = [{ function: { description: "x", name: "search_statute" }, type: "function" }];
    const c = [{ type: "function", function: { name: "search_case_law", description: "x" } }];
    expect(toolTableFingerprint(a)).toBe(toolTableFingerprint(b));
    expect(toolTableFingerprint(a)).not.toBe(toolTableFingerprint(c));
  });

  it("changes when only a description changes (that also invalidates prefix cache)", () => {
    const a = [{ type: "function", function: { name: "t", description: "旧文案" } }];
    const b = [{ type: "function", function: { name: "t", description: "新文案" } }];
    expect(toolTableFingerprint(a)).not.toBe(toolTableFingerprint(b));
  });

  it("estimates schema tokens and reuses the measurement for the same table", () => {
    const tools = [{ type: "function", function: { name: "t", description: "检索法条" } }];
    expect(estimateToolSchemaTokens(tools)).toBeGreaterThan(0);
    expect(estimateToolSchemaTokens([])).toBe(0);
    const meter = new ToolTableMeter();
    const first = meter.measure(tools);
    const second = meter.measure([...tools]);
    expect(second).toBe(first);
  });
});

describe("provider capabilities", () => {
  it("knows DeepSeek reports cache hits", () => {
    const caps = providerCapabilities("deepseek");
    expect(caps.cacheUsage).toBe("deepseek_prompt_cache_hit");
    expect(caps.id).toBe("deepseek");
  });

  it("infers DeepSeek capabilities from the upstream model even when provider is custom", () => {
    const caps = resolveProviderCapabilities({ provider: "custom", model: "deepseek-flash" });
    expect(caps.id).toBe("deepseek");
  });

  it("falls back to a conservative unknown profile", () => {
    const caps = providerCapabilities("some-new-vendor");
    expect(caps.id).toBe("unknown");
    expect(caps.supportsSeed).toBe(false);
  });
});
