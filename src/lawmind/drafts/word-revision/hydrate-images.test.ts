import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractDocxLayout } from "../word-surface-layout.ts";
import { hydrateLayoutImages } from "./hydrate-images.ts";

describe("hydrateLayoutImages", () => {
  it("attaches a data URL for a drawing that points at word/media", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const drawing =
      `<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/>` +
      `<a:graphic><a:graphicData><pic:pic><pic:blipFill>` +
      `<a:blip r:embed="rId9"/>` +
      `</pic:blipFill></pic:pic></a:graphicData></a:graphic>` +
      `</wp:inline></w:drawing></w:r>`;
    const documentXml =
      `<w:document><w:body><w:p>` +
      `<w:r><w:t>盖章</w:t></w:r>` +
      drawing +
      `</w:p></w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", documentXml);
    zip.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>` +
        `</Relationships>`,
    );
    zip.file("word/media/image1.png", png);
    const layout = extractDocxLayout(documentXml);
    const hydrated = await hydrateLayoutImages(layout.blocks, zip);
    const paragraph = hydrated[0];
    expect(paragraph?.kind).toBe("paragraph");
    if (paragraph?.kind !== "paragraph") {
      return;
    }
    const imageRun = paragraph.runs.find((run) => run.image);
    expect(imageRun?.image?.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(imageRun?.image?.widthPx).toBe(96);
    expect(imageRun?.preservedXml).toContain("w:drawing");
  });
});
