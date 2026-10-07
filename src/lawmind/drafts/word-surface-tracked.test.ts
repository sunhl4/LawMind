import { describe, expect, it } from "vitest";
import { rewriteTrackedMarkup } from "./word-surface-tracked.js";

const paragraph =
  `<w:p>` +
  `<w:r><w:t>甲方应于</w:t></w:r>` +
  `<w:del w:id="1" w:author="李律师"><w:r><w:delText>十日</w:delText></w:r></w:del>` +
  `<w:ins w:id="2" w:author="李律师"><w:r><w:t>五日</w:t></w:r></w:ins>` +
  `<w:r><w:t>内付款。</w:t></w:r>` +
  `</w:p>`;

describe("rewriteTrackedMarkup", () => {
  it("accepts one insertion and drops that markup", () => {
    const next = rewriteTrackedMarkup(paragraph, "accept", "2");
    expect(next.changed).toBe(1);
    expect(next.xml).toContain("<w:t>五日</w:t>");
    expect(next.xml).not.toContain("<w:ins ");
    expect(next.xml).toContain("<w:del ");
    expect(next.xml).toContain("<w:delText>十日</w:delText>");
  });

  it("accepts a deletion by removing the struck text", () => {
    const next = rewriteTrackedMarkup(paragraph, "accept", "1");
    expect(next.changed).toBe(1);
    expect(next.xml).not.toContain("十日");
    expect(next.xml).toContain("<w:ins ");
    expect(next.xml).toContain("<w:t>五日</w:t>");
  });

  it("rejects an insertion by dropping it, and restores a rejected deletion", () => {
    const dropIns = rewriteTrackedMarkup(paragraph, "reject", "2");
    expect(dropIns.xml).not.toContain("五日");
    expect(dropIns.xml).toContain("<w:del ");
    const restoreDel = rewriteTrackedMarkup(paragraph, "reject", "1");
    expect(restoreDel.xml).toContain("<w:t>十日</w:t>");
    expect(restoreDel.xml).not.toContain("<w:del ");
    expect(restoreDel.xml).toContain("<w:ins ");
  });

  it("accepts a format revision by dropping rPrChange", () => {
    const xml = `<w:r><w:rPr><w:b/><w:rPrChange w:id="4" w:author="李律师"><w:rPr/></w:rPrChange></w:rPr><w:t>加粗</w:t></w:r>`;
    const next = rewriteTrackedMarkup(xml, "accept", "4");
    expect(next.changed).toBe(1);
    expect(next.xml).toContain("<w:b/>");
    expect(next.xml).not.toContain("rPrChange");
  });

  it("rejects a table row insert by dropping the row", () => {
    const xml =
      `<w:tbl><w:tr><w:trPr><w:ins w:id="6" w:author="张律师"/></w:trPr>` +
      `<w:tc><w:p><w:r><w:t>行</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const next = rewriteTrackedMarkup(xml, "reject", "6");
    expect(next.changed).toBe(1);
    expect(next.xml).not.toContain("行");
    expect(next.xml).not.toContain("w:tr");
  });

  it("accepts every remaining revision in the file", () => {
    const next = rewriteTrackedMarkup(paragraph, "accept");
    expect(next.xml).toBe(
      `<w:p><w:r><w:t>甲方应于</w:t></w:r><w:r><w:t>五日</w:t></w:r><w:r><w:t>内付款。</w:t></w:r></w:p>`,
    );
  });
});
