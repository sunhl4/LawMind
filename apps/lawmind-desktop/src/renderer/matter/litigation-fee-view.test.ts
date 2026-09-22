import { describe, expect, it } from "vitest";
import { acceptanceFeeView } from "./litigation-fee-view";

describe("acceptanceFeeView", () => {
  it("estimates the property-case acceptance fee from free-text 标的金额", () => {
    const view = acceptanceFeeView("15万元");
    expect(view.ok).toBe(true);
    // 15 万 → 50 + 9万×2.5% + 5万×2% = 3300
    expect(view.value).toBe("3,300 元");
    expect(view.hint).toContain("财产案件受理费");
    expect(view.hint).toContain("简易程序");
    expect(view.hint).toContain("诉讼费用交纳办法");
  });

  it("reads Chinese numerals and thousands separators", () => {
    // 32100 → 50 + (32100 − 10000) × 2.5% = 602.5
    expect(acceptanceFeeView("叁万贰仟壹佰元").value).toBe("602.5 元");
    expect(acceptanceFeeView("32,100 元").value).toBe("602.5 元");
  });

  it("refuses to guess on ambiguous amounts instead of showing a wrong fee", () => {
    const view = acceptanceFeeView("本金 32100 元，另案 50000 元");
    expect(view.ok).toBe(false);
    expect(view.value).toBe("—");
    expect(view.hint).toContain("多个金额");
  });

  it("asks for the amount when empty, and explains unreadable input", () => {
    expect(acceptanceFeeView("").hint).toContain("填写标的金额");
    const bad = acceptanceFeeView("以实际结算为准");
    expect(bad.ok).toBe(false);
    expect(bad.hint).toContain("无法从");
  });

  it("never claims the fee is final", () => {
    expect(acceptanceFeeView("15万元").hint).toContain("以法院核定为准");
  });
});
