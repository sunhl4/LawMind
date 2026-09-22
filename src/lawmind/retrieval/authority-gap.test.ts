import { describe, expect, it } from "vitest";
import {
  authorityGapFromToolResult,
  demoCorpusFromToolResult,
  formatAuthorityGapLawyerNotice,
  formatDemoCorpusLawyerNotice,
  isAuthorityGap,
  isDemoCorpusResult,
} from "./authority-gap.js";

describe("authority-gap", () => {
  it("detects refusalRequired / authority none / missingItems", () => {
    expect(isAuthorityGap({ refusalRequired: true })).toBe(true);
    expect(isAuthorityGap({ authority: "none" })).toBe(true);
    expect(isAuthorityGap({ missingItems: ["权威库未检索到相关法条"] })).toBe(true);
    expect(isAuthorityGap({ note: "ok" })).toBe(false);
  });

  it("formats lawyer notice", () => {
    expect(formatAuthorityGapLawyerNotice({ toolName: "search_statute" })).toContain("缺源");
    expect(formatAuthorityGapLawyerNotice({ toolName: "search_statute" })).toContain("法条");
    expect(formatAuthorityGapLawyerNotice({ toolName: "search_statute_web" })).toContain("法条");
    expect(formatAuthorityGapLawyerNotice({ toolName: "search_case_law" })).toContain("类案");
    expect(formatAuthorityGapLawyerNotice({ toolName: "search_case_law" })).toContain("案号");
    expect(formatAuthorityGapLawyerNotice({ note: "自定义说明" })).toContain("自定义说明");
  });

  it("reads gap from tool result envelope", () => {
    expect(
      authorityGapFromToolResult({
        ok: true,
        data: { refusalRequired: true, authority: "none" },
      }),
    ).toBe(true);
    expect(authorityGapFromToolResult({ ok: false, data: { refusalRequired: true } })).toBe(false);
  });

  it("detects missingItems with 未配置/缺源 wording", () => {
    expect(isAuthorityGap({ missingItems: ["权威库未配置"] })).toBe(true);
    expect(isAuthorityGap(null)).toBe(false);
  });

  it("formats generic authority tool notice", () => {
    expect(formatAuthorityGapLawyerNotice({ toolName: "custom_search" })).toContain("权威检索");
  });

  it("detects demo corpus via riskFlags / source.demo / claim.demo", () => {
    expect(isDemoCorpusResult({ riskFlags: ["演示语料（非正式完整法库）"] })).toBe(true);
    expect(isDemoCorpusResult({ sources: [{ demo: true }] })).toBe(true);
    expect(isDemoCorpusResult({ claims: [{ demo: true }] })).toBe(true);
    expect(isDemoCorpusResult({ riskFlags: ["权威库无命中"] })).toBe(false);
    expect(
      demoCorpusFromToolResult({
        ok: true,
        data: { riskFlags: ["演示语料"], sources: [{ title: "x", demo: true }] },
      }),
    ).toBe(true);
    expect(demoCorpusFromToolResult({ ok: false, data: { riskFlags: ["演示语料"] } })).toBe(false);
    expect(formatDemoCorpusLawyerNotice()).toContain("演示语料");
  });
});
