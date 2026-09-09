import { describe, expect, it } from "vitest";
import {
  formatBilateralReviewPromptBlock,
  inferDealRole,
  inferPaperSide,
  shouldInjectBilateralReview,
} from "./bilateral-review.js";
import { loadPracticePlaybook } from "./practice-playbook.js";

describe("bilateral-review", () => {
  it("infers 对方纸 × 采购", () => {
    expect(inferPaperSide("对方出具的采购合同请审查")).toBe("their_paper");
    expect(inferDealRole("我方采购这份设备合同", "sale")).toBe("buy");
  });

  it("infers 己方纸 × 销售", () => {
    expect(inferPaperSide("按我方模板改销售合同")).toBe("our_paper");
    expect(inferDealRole("我方销售侧审这份供货合同", "sale")).toBe("sell");
  });

  it("injects only on unlocked opinion/draft, not mail or Word lock", () => {
    expect(
      shouldInjectBilateralReview({ id: "contract.review", pipeline: "execute_workflow" }),
    ).toBe(true);
    expect(
      shouldInjectBilateralReview({ id: "contract.draft", pipeline: "execute_workflow" }),
    ).toBe(true);
    expect(
      shouldInjectBilateralReview({ id: "contract.review", pipeline: "tracked_redline" }),
    ).toBe(false);
    expect(shouldInjectBilateralReview({ id: "mail.contract", pipeline: "execute_workflow" })).toBe(
      false,
    );
  });

  it("formats paper/role plus never-accept defaults", () => {
    const block = formatBilateralReviewPromptBlock({
      paper: "their_paper",
      role: "buy",
      playbook: loadPracticePlaybook("/tmp/does-not-need-playbook"),
    });
    expect(block).toContain("纸侧与交易角色");
    expect(block).toContain("对方纸");
    expect(block).toContain("采购侧");
    expect(block).toContain("无限责任");
  });
});
