import { describe, expect, it } from "vitest";
import { extractDocxLayout } from "./word-surface-layout.ts";

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
