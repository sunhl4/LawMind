import { describe, expect, it } from "vitest";
import {
  elementInner,
  elementSpan,
  indexOfMatchingClose,
  indexOfWordOpen,
  indexOfXmlTagEnd,
  isWordNameBoundary,
} from "./word-xml-span.js";

const RPR_CHANGE =
  '<w:rPr><w:sz w:val="32"/><w:rPrChange w:id="1" w:author="前手" w:date="2026-10-01T00:00:00Z">' +
  '<w:rPr><w:sz w:val="24"/></w:rPr></w:rPrChange></w:rPr>';

const PPR_CHANGE =
  '<w:pPr><w:spacing w:line="560" w:lineRule="exact"/><w:pPrChange w:id="2" w:author="前手">' +
  '<w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr></w:pPrChange></w:pPr>';

describe("indexOfWordOpen", () => {
  it("matches the tag, not a longer name that starts with it", () => {
    expect(indexOfWordOpen("<w:rPrX/>", "rPr", 0)).toBe(-1);
    expect(indexOfWordOpen("<w:rPr/>", "rPr", 0)).toBe(0);
    expect(indexOfWordOpen('<w:rPr w:rsidR="1">', "rPr", 0)).toBe(0);
  });

  it("respects the `from` offset so the next sibling is reachable", () => {
    const xml = "<w:p>甲</w:p><w:p>乙</w:p>";
    const first = indexOfWordOpen(xml, "p", 0);
    const second = indexOfWordOpen(xml, "p", first + 1);
    expect(first).toBe(0);
    expect(xml.slice(second, second + 5)).toBe("<w:p>");
  });

  it("boundary check accepts whitespace, `>` and `/>` only", () => {
    expect(isWordNameBoundary("<w:p>", 4)).toBe(true);
    expect(isWordNameBoundary("<w:p/>", 4)).toBe(true);
    expect(isWordNameBoundary("<w:p x", 4)).toBe(true);
    expect(isWordNameBoundary("<w:pX", 4)).toBe(false);
  });
});

describe("indexOfXmlTagEnd", () => {
  it("skips `>` inside quoted attribute values", () => {
    const xml = '<w:ind w:hint="a>b" w:firstLineChars="200">';
    const end = indexOfXmlTagEnd(xml, 0);
    expect(xml[end]).toBe(">");
    expect(end).toBe(xml.length - 1);
  });

  it("returns -1 for a truncated tag", () => {
    expect(indexOfXmlTagEnd("<w:p w:val=", 0)).toBe(-1);
  });
});

describe("elementInner", () => {
  it("returns the outer run properties, not the ones preserved inside rPrChange", () => {
    const inner = elementInner(RPR_CHANGE, "rPr");
    expect(inner.startsWith('<w:sz w:val="32"/>')).toBe(true);
    expect(inner.endsWith("</w:rPrChange>")).toBe(true);
    expect(inner).toContain('<w:sz w:val="24"/>');
  });

  it("returns the outer paragraph properties across a nested pPr", () => {
    const inner = elementInner(PPR_CHANGE, "pPr");
    expect(inner.startsWith('<w:spacing w:line="560" w:lineRule="exact"/>')).toBe(true);
    expect(inner.endsWith("</w:pPrChange>")).toBe(true);
  });

  it("does not lose depth when the recorded properties are self-closing", () => {
    const xml = '<w:rPr><w:rPrChange w:id="3" w:author="前手"><w:rPr/></w:rPrChange></w:rPr>';
    const span = elementSpan(xml, "rPr");
    expect(span?.selfClosing).toBe(false);
    expect(span?.end).toBe(xml.length);
    expect(elementInner(xml, "rPr")).toBe(
      '<w:rPrChange w:id="3" w:author="前手"><w:rPr/></w:rPrChange>',
    );
  });

  it("returns empty for a self-closing element instead of the rest of the document", () => {
    expect(elementInner("<w:tblPr/><w:tblGrid/>", "tblPr")).toBe("");
    expect(elementSpan("<w:tblPr/>", "tblPr")?.selfClosing).toBe(true);
  });

  it("refuses to hand back a truncated body for unterminated XML", () => {
    const xml = '<w:rPr><w:b/><w:sz w:val="32"/>';
    expect(elementSpan(xml, "rPr")).toBeUndefined();
    expect(elementInner(xml, "rPr")).toBe("");
    expect(indexOfMatchingClose(xml, 0, "rPr")).toBe(xml.length);
  });

  it("finds the second same-name element when asked to start later", () => {
    const xml = '<w:tr><w:trPr><w:trHeight w:val="400"/></w:trPr></w:tr><w:tr><w:trPr/></w:tr>';
    const second = elementSpan(xml, "trPr", xml.indexOf("<w:trPr/>"));
    expect(second?.selfClosing).toBe(true);
  });
});
