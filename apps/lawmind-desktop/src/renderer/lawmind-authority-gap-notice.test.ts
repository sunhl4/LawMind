import { describe, expect, it } from "vitest";
import {
  formatAuthorityGapLawyerNotice,
  formatDemoCorpusLawyerNotice,
} from "../../../../src/lawmind/retrieval/authority-gap.ts";
import {
  noticeFromToolAuthorityGap,
  noticeFromToolDemoCorpus,
} from "./lawmind-authority-gap-notice";

describe("lawmind-authority-gap-notice (SSE→Banner glue)", () => {
  it("returns undefined when authorityGap is not true", () => {
    expect(noticeFromToolAuthorityGap("search_statute", false)).toBeUndefined();
    expect(noticeFromToolAuthorityGap("search_statute")).toBeUndefined();
  });

  it("uses formatAuthorityGapLawyerNotice as the single copy path", () => {
    const statute = noticeFromToolAuthorityGap("search_statute", true);
    const caseLaw = noticeFromToolAuthorityGap("search_case_law", true);
    const web = noticeFromToolAuthorityGap("search_statute_web", true);
    const other = noticeFromToolAuthorityGap("research_task", true);

    expect(statute).toBe(formatAuthorityGapLawyerNotice({ toolName: "search_statute" }));
    expect(caseLaw).toBe(formatAuthorityGapLawyerNotice({ toolName: "search_case_law" }));
    expect(web).toBe(formatAuthorityGapLawyerNotice({ toolName: "search_statute_web" }));
    expect(other).toBe(formatAuthorityGapLawyerNotice({ toolName: "research_task" }));

    expect(statute).toContain("法条检索");
    expect(caseLaw).toContain("类案检索");
    expect(web).toContain("法条检索");
    expect(other).toContain("权威检索");
  });

  it("surfaces 演示语料 watermark from demoCorpus SSE flag", () => {
    expect(noticeFromToolDemoCorpus(false)).toBeUndefined();
    expect(noticeFromToolDemoCorpus()).toBeUndefined();
    expect(noticeFromToolDemoCorpus(true)).toBe(formatDemoCorpusLawyerNotice());
    expect(noticeFromToolDemoCorpus(true)).toContain("演示语料");
  });
});
