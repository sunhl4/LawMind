import { describe, expect, it } from "vitest";
import {
  chineseHeadingLevel,
  extractDocxLayout,
  styleHeadingLevel,
} from "./word-surface-layout.ts";

describe("word surface layout outline", () => {
  it("reads outlineLvl, heading styles, and Chinese clause headings", () => {
    const styles =
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>` +
      `<w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>` +
      `</w:styles>`;
    const xml =
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>争议焦点</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>一、结论</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>一、付款</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>这是普通正文句子，不应进大纲。</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const layout = extractDocxLayout(xml, styles);
    expect(layout.blocks[0]).toMatchObject({
      kind: "paragraph",
      outlineLevel: 2,
      text: "争议焦点",
    });
    expect(layout.blocks[1]).toMatchObject({
      kind: "paragraph",
      outlineLevel: 1,
      text: "一、结论",
    });
    expect(layout.blocks[2]).toMatchObject({
      kind: "paragraph",
      outlineLevel: 1,
      text: "一、付款",
    });
    expect((layout.blocks[3] as { outlineLevel?: number }).outlineLevel).toBeUndefined();
    expect(styleHeadingLevel("Heading2")).toBe(2);
    expect(styleHeadingLevel("标题3")).toBe(3);
    expect(chineseHeadingLevel("（一）范围")).toBe(2);
  });
});

describe("word surface layout tracks", () => {
  it("reads format revisions, comments, and block-level inserts", () => {
    const xml =
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:commentRangeStart w:id="3"/>` +
      `<w:p>` +
      `<w:pPr><w:pPrChange w:id="9" w:author="李律师"><w:pPr/></w:pPrChange></w:pPr>` +
      `<w:r><w:rPr><w:b/><w:rPrChange w:id="4" w:author="李律师"><w:rPr/></w:rPrChange></w:rPr><w:t>加粗</w:t></w:r>` +
      `</w:p>` +
      `<w:commentRangeEnd w:id="3"/>` +
      `<w:ins w:id="8" w:author="王律师"><w:p><w:r><w:t>整段插入</w:t></w:r></w:p></w:ins>` +
      `</w:body></w:document>`;
    const layout = extractDocxLayout(xml);
    const first = layout.blocks[0];
    const second = layout.blocks[1];
    if (first?.kind !== "paragraph" || second?.kind !== "paragraph") {
      throw new Error("expected paragraphs");
    }
    expect(first.pPrTrack).toEqual(
      expect.objectContaining({ kind: "format", id: "9", author: "李律师" }),
    );
    expect(first.runs.some((run) => run.track?.kind === "format" && run.track.id === "4")).toBe(
      true,
    );
    expect(first.runs.some((run) => run.commentIds?.includes("3"))).toBe(true);
    expect(second.blockTrack).toEqual(
      expect.objectContaining({ kind: "ins", id: "8", author: "王律师" }),
    );
    expect(second.runs[0]?.track?.author).toBe("王律师");
  });

  it("reads table row insert marks", () => {
    const xml =
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tr>` +
      `<w:trPr><w:ins w:id="6" w:author="张律师"/></w:trPr>` +
      `<w:tc><w:p><w:r><w:t>行</w:t></w:r></w:p></w:tc>` +
      `</w:tr></w:tbl>` +
      `</w:body></w:document>`;
    const layout = extractDocxLayout(xml);
    const table = layout.blocks[0];
    if (table?.kind !== "table") {
      throw new Error("expected table");
    }
    expect(table.rows[0]?.[0]?.rowTrack).toEqual(
      expect.objectContaining({ kind: "ins", id: "6", author: "张律师" }),
    );
  });
});

describe("word surface layout breaks", () => {
  it("keeps line breaks, tabs, page breaks, and symbol checks as text sentinels", () => {
    const xml =
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>` +
      `<w:r><w:br/></w:r>` +
      `<w:r><w:t>甲</w:t><w:br/></w:r>` +
      `<w:r><w:t>乙</w:t></w:r>` +
      `<w:r><w:tab/></w:r>` +
      `<w:r><w:t>丙&#xB;丁</w:t></w:r>` +
      `<w:r><w:br w:type="page"/></w:r>` +
      `<w:r><w:cr/></w:r>` +
      `<w:r><w:t>戊</w:t></w:r>` +
      `<w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r>` +
      `<w:r><w:noBreakHyphen/></w:r>` +
      `</w:p></w:body></w:document>`;
    const layout = extractDocxLayout(xml);
    const paragraph = layout.blocks[0];
    expect(paragraph?.kind).toBe("paragraph");
    if (paragraph?.kind !== "paragraph") {
      return;
    }
    expect(paragraph.text).toBe("\n甲\n乙\t丙\n丁\f\n戊✓\u2011");
  });
});
