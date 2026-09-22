import { describe, expect, it } from "vitest";
import { buildResearchFastLanePrompt, RESEARCH_FAST_LANE_OPTIONS } from "./lawmind-research-fast-lane";

describe("lawmind-research-fast-lane", () => {
  it("exposes three solo lanes", () => {
    expect(RESEARCH_FAST_LANE_OPTIONS.map((o) => o.id)).toEqual([
      "compliance",
      "learning",
      "training",
    ]);
  });

  it("primes outline-first language for each kind", () => {
    expect(buildResearchFastLanePrompt("compliance", "数据出境")).toMatch(/大纲/);
    expect(buildResearchFastLanePrompt("compliance", "数据出境")).toContain("数据出境");
    expect(buildResearchFastLanePrompt("compliance", "数据出境")).toContain(
      "交付物类型代码：report.compliance",
    );
    expect(buildResearchFastLanePrompt("compliance", "数据出境")).not.toContain("【可粘贴】");
    expect(buildResearchFastLanePrompt("learning", "个保法")).toMatch(/效力/);
    expect(buildResearchFastLanePrompt("learning", "个保法")).toContain(
      "交付物类型代码：report.learning",
    );
    expect(buildResearchFastLanePrompt("training", "出口管制")).toMatch(/已脱敏|脱敏/);
  });

  it("includes jurisdictions and urls when provided for compliance", () => {
    const p = buildResearchFastLanePrompt("compliance", "NEV 出口", {
      jurisdictions: "中国内地 / 欧盟",
      urls: "https://example.com/reg",
    });
    expect(p).toContain("中国内地 / 欧盟");
    expect(p).toContain("https://example.com/reg");
  });
});
