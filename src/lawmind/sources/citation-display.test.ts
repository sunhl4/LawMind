import { describe, expect, it } from "vitest";
import {
  citationFootnoteMarker,
  formatLawyerFacingCitation,
  formatSectionSeeAlsoLine,
  looksLikeOpaqueSourceId,
  sourceKindLabelZh,
} from "./citation-display.js";

describe("citation-display", () => {
  it("detects opaque source ids", () => {
    expect(looksLikeOpaqueSourceId("src-1")).toBe(true);
    expect(looksLikeOpaqueSourceId("s-001")).toBe(true);
    expect(looksLikeOpaqueSourceId("《合同法》第107条")).toBe(false);
  });

  it("prefers citation string over id/title noise", () => {
    expect(
      formatLawyerFacingCitation({
        id: "src-1",
        title: "src-1",
        citation: "《中华人民共和国合同法》第107条",
        kind: "statute",
      }),
    ).toBe("《中华人民共和国合同法》第107条");
  });

  it("uses case number for judgments", () => {
    expect(
      formatLawyerFacingCitation({
        id: "src-9",
        title: "某买卖合同纠纷",
        kind: "case",
        court: "最高人民法院",
        caseNumber: "（2020）最高法民终123号",
      }),
    ).toBe("最高人民法院（2020）最高法民终123号");
  });

  it("never returns raw source id as primary label", () => {
    expect(formatLawyerFacingCitation({ id: "src-1", title: "src-1" })).toBe("引用待核实");
  });

  it("maps kind labels and footnote markers", () => {
    expect(sourceKindLabelZh("statute")).toBe("法律");
    expect(citationFootnoteMarker(0)).toBe("①");
    expect(citationFootnoteMarker(10)).toBe("11");
  });

  it("builds see-also lines without opaque ids", () => {
    expect(
      formatSectionSeeAlsoLine(
        ["src-1", "src-2"],
        [
          { id: "src-1", citation: "《合同法》第107条" },
          { id: "src-2", caseNumber: "（2020）最高法民终1号", court: "最高人民法院" },
        ],
      ),
    ).toBe("参见：①《合同法》第107条；②最高人民法院（2020）最高法民终1号。");
    expect(formatSectionSeeAlsoLine(["src-9"], [])).toBe("参见：①引用待核实。");
  });
});
