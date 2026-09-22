import { describe, expect, it } from "vitest";
import {
  extractComplaintFillPlan,
  formatComplaintEvidenceBlock,
  formatComplaintFactsBlock,
  formatComplaintPartyBlock,
} from "./complaint-fill-plan.js";

describe("complaint-fill-plan", () => {
  it("keeps a linear element chain without markdown tables", () => {
    const plan = extractComplaintFillPlan("写起诉状");
    expect(formatComplaintFactsBlock(plan)).not.toMatch(/\| --- \|/);
    expect(formatComplaintPartyBlock(plan)).toContain("原告：");
    expect(formatComplaintFactsBlock(plan)).toContain("要件：");
  });

  it("fills obvious parties from the instruction", () => {
    const plan = extractComplaintFillPlan(
      "原告：张三，被告：某科技有限公司。向海淀区人民法院起诉。写起诉状。",
    );
    expect(plan.plaintiffs).toBe("张三");
    expect(plan.defendants).toBe("某科技有限公司");
    expect(plan.court).toBe("海淀区人民法院");
  });

  it("fills 要件 facts from oral 拖欠工资", () => {
    const plan = extractComplaintFillPlan("原告：张三。他一直拖欠工资。写起诉状。");
    expect(plan.elements[0]?.facts).toContain("未及时足额支付劳动报酬");
  });

  it("fills named 工资流水 onto the evidence column and leaves the rest 待补", () => {
    const plan = extractComplaintFillPlan("原告：张三。他一直拖欠工资，有工资流水。写起诉状。");
    expect(plan.elements[0]?.evidence).toBe("工资或银行流水");
    expect(formatComplaintFactsBlock(plan)).toContain("工资或银行流水");
    expect(formatComplaintEvidenceBlock(plan)).toContain("待证事实");
  });
});
