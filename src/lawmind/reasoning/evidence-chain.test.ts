import { describe, expect, it } from "vitest";
import {
  extractEvidenceChain,
  extractNamedEvidence,
  formatEvidenceChainBlock,
} from "./evidence-chain.js";

describe("evidence-chain", () => {
  it("does not invent exhibits when the instruction names none", () => {
    const links = extractEvidenceChain("写起诉状，他一直拖欠工资");
    expect(extractNamedEvidence("写起诉状，他一直拖欠工资")).toEqual([]);
    expect(links[0]?.evidence).toContain("待补充");
    expect(links[0]?.weight).toBe("待补");
    expect(formatEvidenceChainBlock(links)).toContain("缺证写待补，不停工");
  });

  it("fills named 工资流水 and 劳动合同 without adding extra files", () => {
    const named = extractNamedEvidence("有劳动合同和工资流水。写起诉状。");
    expect(named.map((row) => row.name)).toEqual(["工资或银行流水", "劳动合同"]);
    const links = extractEvidenceChain("有劳动合同和工资流水。他一直拖欠工资。", [
      { element: "给付劳动报酬", facts: "用人单位未及时足额支付劳动报酬" },
    ]);
    expect(links.some((row) => row.evidence === "工资或银行流水")).toBe(true);
    expect(links.some((row) => row.evidence === "劳动合同")).toBe(true);
    expect(links.every((row) => row.evidence !== "发票")).toBe(true);
  });
});
