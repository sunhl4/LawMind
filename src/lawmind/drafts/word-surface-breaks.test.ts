import { describe, expect, it } from "vitest";
import {
  decodeXmlEntities,
  normalizeWordControls,
  serializeWordRunText,
  wordSymbolText,
} from "./word-surface-breaks.ts";

describe("word surface breaks", () => {
  it("turns Word line-break controls into a line feed", () => {
    expect(normalizeWordControls("甲\u000B乙\r\n丙\r丁")).toBe("甲\n乙\n丙\n丁");
    expect(decodeXmlEntities("甲&#xB;乙&#11;丙")).toBe("甲\u000B乙\u000B丙");
    expect(normalizeWordControls(decodeXmlEntities("甲&#xB;乙"))).toBe("甲\n乙");
  });

  it("maps symbol-font checks and drops private-use boxes", () => {
    expect(wordSymbolText("Wingdings", "F0FC")).toBe("✓");
    expect(wordSymbolText("Wingdings", "F06C")).toBe("•");
    expect(wordSymbolText("Wingdings", "F0FF")).toBe("");
    expect(wordSymbolText("", "2022")).toBe(String.fromCodePoint(0x2022));
  });

  it("writes breaks and tabs as elements, not characters inside w:t", () => {
    const xml = serializeWordRunText("甲\n乙\t丙\f丁", "t");
    expect(xml).toBe(
      '<w:t xml:space="preserve">甲</w:t><w:br/>' +
        '<w:t xml:space="preserve">乙</w:t><w:tab/>' +
        '<w:t xml:space="preserve">丙</w:t><w:br w:type="page"/>' +
        '<w:t xml:space="preserve">丁</w:t>',
    );
    expect(serializeWordRunText("\n", "t")).toBe("<w:br/>");
    expect(serializeWordRunText("只是正文", "delText")).toBe(
      '<w:delText xml:space="preserve">只是正文</w:delText>',
    );
  });
});
