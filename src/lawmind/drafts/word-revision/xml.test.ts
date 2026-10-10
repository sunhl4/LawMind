import { describe, expect, it } from "vitest";
import { extractDocxLayout } from "../word-surface-layout.ts";
import { insertText, inspectRuns, makeAuthorClock } from "./compose.ts";
import { layoutRunsToRevision } from "./document.ts";
import { insertEmptyTableRowInXml, replaceParagraphRunsInXml, serializeRuns } from "./xml.ts";

describe("Word revision XML", () => {
  it("round-trips an insert after someone else's mark", () => {
    const xml =
      `<w:document><w:body><w:p>` +
      `<w:r><w:t>甲方应于</w:t></w:r>` +
      `<w:del w:id="1" w:author="李律师"><w:r><w:delText>十日</w:delText></w:r></w:del>` +
      `<w:ins w:id="2" w:author="李律师"><w:r><w:t>五日</w:t></w:r></w:ins>` +
      `<w:r><w:t>付款。</w:t></w:r>` +
      `</w:p></w:body></w:document>`;
    const layout = extractDocxLayout(xml);
    const paragraph = layout.blocks[0];
    if (paragraph?.kind !== "paragraph") {
      throw new Error("expected paragraph");
    }
    const zhang = makeAuthorClock("张律师", 3);
    const runs = insertText(layoutRunsToRevision(paragraph.runs), 8, "内", zhang);
    const next = replaceParagraphRunsInXml(xml, [{ runs }]);
    expect(serializeRuns(runs)).toContain('w:author="张律师"');
    expect(next.xml).toContain('w:author="张律师"');
    expect(next.xml).toContain('w:author="李律师"');
    const reloaded = extractDocxLayout(next.xml);
    const again = reloaded.blocks[0];
    if (again?.kind !== "paragraph") {
      throw new Error("expected paragraph");
    }
    expect(inspectRuns(layoutRunsToRevision(again.runs))).toEqual([
      ["甲方应于", undefined, undefined],
      ["十日", "del", "李律师"],
      ["五日", "ins", "李律师"],
      ["内", "ins", "张律师"],
      ["付款。", undefined, undefined],
    ]);
  });

  it("writes line breaks and tabs as elements", () => {
    const xml = serializeRuns([{ text: "甲\n乙\t丙" }]);
    expect(xml).toContain('<w:t xml:space="preserve">甲</w:t><w:br/>');
    expect(xml).toContain("<w:tab/>");
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*[\n\t]/u);
    const layout = extractDocxLayout(`<w:document><w:body><w:p>${xml}</w:p></w:body></w:document>`);
    const paragraph = layout.blocks[0];
    expect(paragraph?.kind).toBe("paragraph");
    if (paragraph?.kind === "paragraph") {
      expect(paragraph.text).toBe("甲\n乙\t丙");
    }
  });

  it("writes comment ranges around runs", () => {
    const xml = serializeRuns([{ text: "甲方", commentIds: ["1"] }, { text: "应于" }]);
    expect(xml).toContain('<w:commentRangeStart w:id="1"/>');
    expect(xml).toContain('<w:commentRangeEnd w:id="1"/>');
    expect(xml).toContain('<w:commentReference w:id="1"/>');
  });

  it("inserts an empty table row after the given index", () => {
    const xml =
      `<w:document><w:body><w:tbl>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl></w:body></w:document>`;
    const next = insertEmptyTableRowInXml(xml, 0, 0);
    expect(next.ok).toBe(true);
    if (!next.ok) {
      return;
    }
    const layout = extractDocxLayout(next.xml);
    const table = layout.blocks[0];
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") {
      return;
    }
    expect(table.rows).toHaveLength(2);
    expect(
      table.rows[0]?.map((cell) =>
        cell.blocks[0]?.kind === "paragraph" ? cell.blocks[0].text : "",
      ),
    ).toEqual(["甲", "乙"]);
    expect(
      table.rows[1]?.map((cell) =>
        cell.blocks[0]?.kind === "paragraph" ? cell.blocks[0].text : "",
      ),
    ).toEqual(["", ""]);
    expect(next.xml).toContain('w:tcW w:w="2000"');
  });

  it("inserts into a nested table instead of the following sibling table", () => {
    const xml =
      `<w:document><w:body>` +
      `<w:tbl><w:tr>` +
      `<w:tc><w:p><w:r><w:t>外</w:t></w:r></w:p>` +
      `<w:tbl><w:tr>` +
      `<w:tc><w:p><w:r><w:t>内</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t>内二</w:t></w:r></w:p></w:tc>` +
      `</w:tr></w:tbl></w:tc>` +
      `<w:tc><w:p><w:r><w:t>右</w:t></w:r></w:p></w:tc>` +
      `</w:tr></w:tbl>` +
      `<w:tbl><w:tr>` +
      `<w:tc><w:p><w:r><w:t>旁</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t>旁二</w:t></w:r></w:p></w:tc>` +
      `</w:tr></w:tbl>` +
      `</w:body></w:document>`;
    const next = insertEmptyTableRowInXml(xml, 1, 0);
    expect(next.ok).toBe(true);
    if (!next.ok) {
      return;
    }
    const layout = extractDocxLayout(next.xml);
    const outer = layout.blocks[0];
    const sibling = layout.blocks[1];
    expect(outer?.kind).toBe("table");
    expect(sibling?.kind).toBe("table");
    if (outer?.kind !== "table" || sibling?.kind !== "table") {
      return;
    }
    const nested = outer.rows[0]?.[0]?.blocks.find((block) => block.kind === "table");
    expect(nested?.kind).toBe("table");
    if (nested?.kind !== "table") {
      return;
    }
    expect(nested.rows).toHaveLength(2);
    expect(sibling.rows).toHaveLength(1);
  });

  it("inserts a new w:p when sourceIndex is null", () => {
    const xml =
      `<w:document><w:body>` +
      `<w:p><w:r><w:t>第一段</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>第二段</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const next = replaceParagraphRunsInXml(xml, [
      { sourceIndex: 0, runs: [{ text: "第一段上" }] },
      { sourceIndex: null, runs: [{ text: "插入段" }] },
      { sourceIndex: 1, runs: [{ text: "第二段" }] },
    ]);
    expect(next.xml).toContain(">第一段上<");
    expect(next.xml).toContain(">插入段<");
    expect(next.xml).toContain(">第二段<");
    const layout = extractDocxLayout(next.xml);
    const texts = layout.blocks
      .filter((block) => block.kind === "paragraph")
      .map((block) => (block.kind === "paragraph" ? block.text : ""));
    expect(texts).toEqual(["第一段上", "插入段", "第二段"]);
  });

  it("round-trips a drawing run through extract → edit → replace without dropping w:drawing", () => {
    const drawing =
      `<w:r><w:drawing><wp:inline>` +
      `<a:graphic><a:graphicData><pic:pic>` +
      `<pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill>` +
      `</pic:pic></a:graphicData></a:graphic>` +
      `</wp:inline></w:drawing></w:r>`;
    const xml =
      `<w:document><w:body><w:p>` +
      `<w:r><w:t>盖章：</w:t></w:r>` +
      drawing +
      `<w:r><w:t>处。</w:t></w:r>` +
      `</w:p></w:body></w:document>`;
    const layout = extractDocxLayout(xml);
    const paragraph = layout.blocks[0];
    if (paragraph?.kind !== "paragraph") {
      throw new Error("expected paragraph");
    }
    expect(paragraph.runs.some((run) => run.preservedXml?.includes("w:drawing"))).toBe(true);
    const zhang = makeAuthorClock("张律师", 1);
    const runs = insertText(layoutRunsToRevision(paragraph.runs), 3, "见", zhang);
    const next = replaceParagraphRunsInXml(xml, [{ runs }]);
    expect(next.xml).toContain("<w:drawing>");
    expect(next.xml).toContain('r:embed="rId9"');
    expect(next.xml).toContain('w:author="张律师"');
    const reloaded = extractDocxLayout(next.xml);
    const again = reloaded.blocks[0];
    if (again?.kind !== "paragraph") {
      throw new Error("expected paragraph");
    }
    expect(again.runs.some((run) => run.preservedXml?.includes("w:drawing"))).toBe(true);
  });
});
