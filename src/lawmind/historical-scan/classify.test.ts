import { describe, expect, it } from "vitest";
import { classifyDocKind, classifyLayout, proposedMatterLabel } from "./classify.js";

describe("historical-scan classify", () => {
  it("classifies contract vs litigation vs messy desktop", () => {
    expect(classifyDocKind("供货合同-终稿.docx")).toBe("contract");
    expect(classifyDocKind("民事起诉状.pdf")).toBe("litigation");
    expect(classifyLayout("桌面", 9)).toBe("messy");
    expect(classifyLayout("华能采购案", 4)).toBe("organized");
    expect(proposedMatterLabel("华能采购案", "organized")).toBe("华能采购案");
    expect(proposedMatterLabel("下载", "messy")).toBeUndefined();
  });
});
