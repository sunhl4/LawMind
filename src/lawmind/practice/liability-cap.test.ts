import { describe, expect, it } from "vitest";
import { extractLiabilityCapFill, formatLiabilityCapBody } from "./liability-cap.js";

describe("liability-cap", () => {
  it("fills four positions from defaults and flags 无限责任", () => {
    const fill = extractLiabilityCapFill("对方合同写无限责任，请审查这份采购合同");
    expect(fill.neverHits).toContain("无限责任");
    const body = formatLiabilityCapBody(fill);
    expect(body).toContain("直接损失上限");
    expect(body).toContain("间接/可得利益");
    expect(body).toContain("carve-out");
    expect(body).toContain("基数定义");
    expect(body).toContain("破局条款");
    expect(body).toContain("永不接受命中：无限责任");
  });
});
