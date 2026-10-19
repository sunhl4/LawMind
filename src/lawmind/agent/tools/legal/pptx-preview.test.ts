import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { loadPptxUiPreview, parsePptxPreviewBuffer } from "./pptx-preview.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function buildSamplePptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0"?>` +
      `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<p:sldSz cx="12192000" cy="6858000"/>` +
      `<p:sldIdLst>` +
      `<p:sldId id="256" r:id="rId2"/>` +
      `<p:sldId id="257" r:id="rId3"/>` +
      `</p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<p:cSld><p:spTree>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/>` +
      `<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
      `<p:txBody><a:p><a:r><a:t>案件进展汇报</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>` +
      `<p:txBody>` +
      `<a:p><a:r><a:t>争议焦点一</a:t></a:r></a:p>` +
      `<a:p><a:r><a:t>下一步举证</a:t></a:r></a:p>` +
      `</p:txBody></p:sp>` +
      `</p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/slide2.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<p:cSld><p:spTree>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/>` +
      `<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
      `<p:txBody><a:p><a:r><a:t>对照表</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:graphicFrame><a:graphic><a:graphicData>` +
      `<a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>管辖</a:t></a:r></a:p></a:txBody></a:tc>` +
      `<a:tc><a:txBody><a:p><a:r><a:t>上海仲裁</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>` +
      `</a:graphicData></a:graphic></p:graphicFrame>` +
      `</p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    `<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<p:cSld><p:spTree><p:sp><p:txBody>` +
      `<a:p><a:r><a:t>口头强调管辖条款</a:t></a:r></a:p>` +
      `</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("parsePptxPreviewBuffer", () => {
  it("orders slides, keeps title/body roles, and attaches notes", async () => {
    const loaded = await parsePptxPreviewBuffer(await buildSamplePptx());
    expect(loaded.slides).toHaveLength(2);
    expect(loaded.slideWidthEmu).toBe(12192000);
    expect(loaded.slides[0]?.blocks.find((b) => b.role === "title")?.text).toBe("案件进展汇报");
    expect(loaded.slides[0]?.blocks.filter((b) => b.role === "body").map((b) => b.text)).toEqual([
      "争议焦点一",
      "下一步举证",
    ]);
    expect(loaded.slides[0]?.blocks.find((b) => b.role === "notes")?.text).toBe("口头强调管辖条款");
    expect(loaded.slides[1]?.blocks.find((b) => b.role === "title")?.text).toBe("对照表");
    expect(loaded.slides[1]?.blocks.filter((b) => b.role === "body").map((b) => b.text)).toEqual([
      "管辖",
      "上海仲裁",
    ]);
  });
});

describe("loadPptxUiPreview", () => {
  it("reads a file from disk", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-pptx-"));
    dirs.push(dir);
    const file = path.join(dir, "汇报.pptx");
    await fs.writeFile(file, await buildSamplePptx());
    const loaded = await loadPptxUiPreview(file);
    expect(loaded.slides[0]?.label).toBe("1");
    expect(loaded.truncatedSlides).toBe(false);
  });
});
