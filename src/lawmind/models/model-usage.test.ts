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
