import { describe, expect, it } from "vitest";
import {
  appendCampaignUpgradeInstruction,
  extractReviewBrief,
  formatReviewBriefHeader,
  mergeSourceTextWithBrief,
} from "./review-brief.js";

const DISPATCH = `【交办】5 分钟合同审查
交付物类型：合同审查意见
交办要点：
- 审查重点：付款与违约
- 己方立场：委托方（保护我方利益）

审查深度：深度。逐条细查关键条款。`;

describe("review-brief", () => {
  it("extracts stance, focus and depth from a fast-lane dispatch", () => {
    const brief = extractReviewBrief(DISPATCH);
    expect(brief.focus).toBe("付款与违约");
    expect(brief.stance).toContain("委托方");
    expect(brief.depth).toBe("深度");
  });

  it("prefixes source text so campaign roles keep the same口径", () => {
    const brief = extractReviewBrief(DISPATCH);
    const merged = mergeSourceTextWithBrief("合同正文。无责任上限。", brief);
    expect(merged).toContain(
      "【审查口径】立场：委托方（保护我方利益）；重点：付款与违约；深度：深度",
    );
    expect(merged).toContain("合同正文。无责任上限。");
    expect(mergeSourceTextWithBrief(merged, brief)).toBe(merged);
  });

  it("keeps stance/focus when upgrading to a full campaign", () => {
    const upgraded = appendCampaignUpgradeInstruction(DISPATCH, extractReviewBrief(DISPATCH));
    expect(upgraded).toContain("【审查口径】");
    expect(upgraded).toContain("委托方");
    expect(upgraded).toContain("付款与违约");
    expect(upgraded).toContain("完整合同审查专案组");
    expect(formatReviewBriefHeader({})).toBe("");
  });
});
