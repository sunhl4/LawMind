import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  mergeUsageSnapshots,
  recordModelUsage,
  summarizeModelUsage,
  usageFromProvider,
} from "./model-usage.js";

describe("model-usage", () => {
  it("records and summarizes ledger rows", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-usage-"));
    recordModelUsage(ws, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      model: "gpt-test",
    });
    const sum = summarizeModelUsage(ws, { sinceDays: 7 });
    expect(sum.entries).toBe(1);
    expect(sum.totalTokens).toBe(15);
    expect(sum.byModel).toEqual([{ model: "gpt-test", entries: 1, totalTokens: 15 }]);
    expect(sum.byTier).toEqual([{ tier: "general", label: "通用", entries: 1, totalTokens: 15 }]);
  });

  it("groups byTier advisor vs worker", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-usage-"));
    recordModelUsage(ws, {
      promptTokens: 10,
      completionTokens: 0,
      totalTokens: 10,
      model: "qwen-max",
    });
    recordModelUsage(ws, {
      promptTokens: 3,
      completionTokens: 0,
      totalTokens: 3,
      model: "qwen-turbo",
    });
    const sum = summarizeModelUsage(ws, { sinceDays: 7 });
    expect(sum.byTier).toEqual([
      { tier: "advisor", label: "Advisor（重推理）", entries: 1, totalTokens: 10 },
      { tier: "worker", label: "Worker（快执行）", entries: 1, totalTokens: 3 },
    ]);
  });

  it("groups byModel and keeps top 8 by totalTokens", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-usage-"));
    for (let i = 0; i < 10; i += 1) {
      recordModelUsage(ws, {
        promptTokens: i + 1,
        completionTokens: 0,
        totalTokens: i + 1,
        model: `model-${i}`,
      });
    }
    recordModelUsage(ws, {
      promptTokens: 100,
      completionTokens: 0,
      totalTokens: 100,
      model: "heavy-model",
    });
    const sum = summarizeModelUsage(ws, { sinceDays: 7 });
    expect(sum.byModel).toHaveLength(8);
    expect(sum.byModel?.[0]).toEqual({ model: "heavy-model", entries: 1, totalTokens: 100 });
  });

  it("merges provider usage snapshots", () => {
    expect(usageFromProvider({ prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 })).toEqual({
      promptTokens: 3,
      completionTokens: 1,
      totalTokens: 4,
    });
    expect(
      mergeUsageSnapshots(
        { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        { promptTokens: 2, completionTokens: 0, totalTokens: 2 },
      ),
    ).toEqual({ promptTokens: 3, completionTokens: 1, totalTokens: 4 });
  });
});
