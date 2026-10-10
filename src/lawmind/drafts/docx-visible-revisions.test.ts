import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { writeVisibleTrackedEdits } from "./docx-visible-revisions.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("writeVisibleTrackedEdits", () => {
  it("writes a real Word deletion and insertion for a unique sentence", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-docx-rev-"));
    dirs.push(dir);
    const source = path.join(dir, "合同.docx");
    const dest = path.join(dir, "合同_修订.docx");
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        `<w:p><w:r><w:rPr><w:sz w:val="21"/></w:rPr><w:t>甲方应于十日内付款。</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
    );
    fs.writeFileSync(source, await zip.generateAsync({ type: "nodebuffer" }));
    const result = await writeVisibleTrackedEdits({
      sourceAbs: source,
      destAbs: dest,
      hunks: [{ before: "甲方应于十日内付款。", after: "甲方应于五日内付款。" }],
    });
    expect(result.applied).toBe(1);
    const out = await JSZip.loadAsync(fs.readFileSync(dest));
    const xml = await out.file("word/document.xml")?.async("string");
    expect(xml).toContain("<w:del ");
    expect(xml).toContain("<w:ins ");
    expect(xml).toContain(">十</w:delText>");
    expect(xml).toContain(">五</w:t>");
    expect(xml).toContain("甲方应于");
    expect(xml).toContain("日内付款。");
  });
});
