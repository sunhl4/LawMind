import { describe, expect, it } from "vitest";
import { formatCacheAbMarkdown, runCacheAb } from "./cache-ab.js";

describe("cache A/B report", () => {
  it("reports cached tokens when the upstream returns them", async () => {
    const usages = [
      { promptTokens: 4_000, completionTokens: 40, cachedTokens: 0, uncachedTokens: 4_000 },
      { promptTokens: 4_020, completionTokens: 40, cachedTokens: 3_600, uncachedTokens: 420 },
      { promptTokens: 4_600, completionTokens: 40, cachedTokens: 400, uncachedTokens: 4_200 },
    ];
    let i = 0;
    const report = await runCacheAb({
      fixedInputTokens: 3_800,
      systemPrompt: "系统",
      sample: async () => usages[i++],
    });
    expect(report.cacheReporting).toBe("reported");
    expect(report.steps.map((s) => s.id)).toEqual(["cold", "repeat", "tool_table_changed"]);
    expect(report.repeatHitRatio).toBeGreaterThan(0.8);
    expect(report.toolTableChangeRetention).toBeGreaterThan(0);
    expect(report.toolTableChangeRetention).toBeLessThan(0.2);
  });

  it("says absent rather than zero when the upstream omits cache fields", async () => {
    const report = await runCacheAb({
      fixedInputTokens: 1_000,
      systemPrompt: "系统",
      sample: async () => ({ promptTokens: 1_000, completionTokens: 10 }),
    });
    expect(report.cacheReporting).toBe("absent");
    expect(report.repeatHitRatio).toBeNull();
    expect(report.toolTableChangeRetention).toBeNull();
    const md = formatCacheAbMarkdown(report);
    expect(md).toContain("不能把缺失写成 0");
    expect(md).toContain("未回报");
  });
});
