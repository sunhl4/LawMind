import { describe, expect, it } from "vitest";
import {
  extractLegalElements,
  formatLegalElementsBody,
  hasExtractedLegalFacts,
} from "./legal-elements.js";

describe("legal-elements", () => {
  it("turns 拖欠工资 oral speech into a payment-of-wages fact", () => {
    const extracted = extractLegalElements("他一直拖欠工资这算不算违法");
    expect(extracted.facts).toContain("用人单位未及时足额支付劳动报酬");
    expect(extracted.slots.act).toContain("劳动报酬");
    expect(hasExtractedLegalFacts(extracted)).toBe(true);
    expect(formatLegalElementsBody(extracted)).toContain("未及时足额支付劳动报酬");
    expect(formatLegalElementsBody(extracted)).toContain("主体");
  });

  it("maps 开除 to 单方解除 and strips evaluative noise", () => {
    const extracted = extractLegalElements("被公司开除了，太坑了，肯定违法");
    expect(extracted.facts).toContain("用人单位单方解除劳动合同");
    expect(formatLegalElementsBody(extracted)).not.toContain("太坑了");
  });

  it("keeps empty slots as 待补充", () => {
    const extracted = extractLegalElements("写一份备忘");
    expect(extracted.facts).toEqual([]);
    expect(formatLegalElementsBody(extracted)).toContain("【待补充】");
  });
});
