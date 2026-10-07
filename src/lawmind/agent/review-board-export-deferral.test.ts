import { describe, expect, it } from "vitest";
import {
  formatReviewBoardExportBounce,
  isReviewBoardExportDeferralReply,
} from "./review-board-export-deferral.js";

describe("isReviewBoardExportDeferralReply", () => {
  it("catches 审核台放行才能出 Word", () => {
    expect(
      isReviewBoardExportDeferralReply(
        "余 6 份需您在审核台放行，我才能出 Word。回「继续」逐份出稿。",
      ),
    ).toBe(true);
  });

  it("catches false claims that export tools are closed", () => {
    expect(
      isReviewBoardExportDeferralReply("本轮改稿与导出工具未开（只读、检索可用）。回继续出 Word。"),
    ).toBe(true);
  });

  it("ignores ordinary review talk", () => {
    expect(isReviewBoardExportDeferralReply("请在 Word 里逐处接受修订后再对外。")).toBe(false);
    expect(isReviewBoardExportDeferralReply("管辖条款建议改诉讼。")).toBe(false);
  });
});

describe("formatReviewBoardExportBounce", () => {
  it("tells the model to export with in-doc marks", () => {
    const text = formatReviewBoardExportBounce();
    expect(text).toContain("render_tracked_draft");
    expect(text).toContain("【待核实】");
    expect(text).toContain("不要请律师去审核台放行");
  });
});
