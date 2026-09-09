import { describe, expect, it } from "vitest";
import { formatNormValidityBody, scanRepealedStatutes } from "./norm-validity.js";

describe("norm-validity", () => {
  it("flags 《合同法》 and does not flag 劳动合同法", () => {
    expect(scanRepealedStatutes("依据《合同法》第107条")).toEqual([
      { title: "合同法", replaceWith: "民法典合同编" },
    ]);
    expect(scanRepealedStatutes("依据《劳动合同法》第47条")).toEqual([]);
    expect(formatNormValidityBody("依据合同法主张违约金")).toContain("已废止");
    expect(formatNormValidityBody("依据《劳动合同法》第47条")).not.toContain("《合同法》已废止");
  });

  it("flags 民法通则 / 物权法 / 担保法 / 侵权责任法", () => {
    const titles = scanRepealedStatutes("民法通则、物权法、担保法、侵权责任法").map((h) => h.title);
    expect(titles).toEqual(["民法通则", "物权法", "担保法", "侵权责任法"]);
  });
});
