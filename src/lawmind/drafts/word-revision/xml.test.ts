import { describe, expect, it } from "vitest";
import { extractDocxLayout } from "../word-surface-layout.ts";
import { insertText, inspectRuns, makeAuthorClock } from "./compose.ts";
import { layoutRunsToRevision } from "./document.ts";
import { replaceParagraphRunsInXml, serializeRuns } from "./xml.ts";

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

  it("writes comment ranges around runs", () => {
    const xml = serializeRuns([{ text: "甲方", commentIds: ["1"] }, { text: "应于" }]);
    expect(xml).toContain('<w:commentRangeStart w:id="1"/>');
    expect(xml).toContain('<w:commentRangeEnd w:id="1"/>');
    expect(xml).toContain('<w:commentReference w:id="1"/>');
  });
});
