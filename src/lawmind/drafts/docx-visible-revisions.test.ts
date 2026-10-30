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
    // Hard control: inserted/deleted runs keep the original run props.
    expect(xml).toMatch(/<w:ins[\s\S]*?<w:rPr>[\s\S]*?w:val="21"/);
    expect(xml).toMatch(/<w:del[\s\S]*?<w:rPr>[\s\S]*?w:val="21"/);
  });

  it("stamps each hunk with a different revision time", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-docx-rev-"));
    dirs.push(dir);
    const source = path.join(dir, "合同.docx");
    const dest = path.join(dir, "合同_修订.docx");
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        `<w:p><w:r><w:t>甲方应于十日内付款。</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>乙方应于三十日内交货。</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
    );
    fs.writeFileSync(source, await zip.generateAsync({ type: "nodebuffer" }));
    const result = await writeVisibleTrackedEdits({
      sourceAbs: source,
      destAbs: dest,
      hunks: [
        { before: "甲方应于十日内付款。", after: "甲方应于五日内付款。" },
        { before: "乙方应于三十日内交货。", after: "乙方应于十五日内交货。" },
      ],
      now: new Date("2026-10-30T09:30:00Z"),
      timestampSeed: "task-1",
    });
    expect(result.applied).toBe(2);
    const out = await JSZip.loadAsync(fs.readFileSync(dest));
    const xml = (await out.file("word/document.xml")?.async("string")) ?? "";
    const dates = [...xml.matchAll(/w:date="([^"]+)"/g)].map((match) => match[1]);
    expect(dates).toHaveLength(4);
    expect(new Set(dates).size).toBe(2);
    for (const date of dates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
  });
});
