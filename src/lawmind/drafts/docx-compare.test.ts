import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alignParagraphLists, writeDocxCompareCopy } from "./docx-compare.ts";

async function writeMinimalDocx(abs: string, paragraphs: string[]): Promise<void> {
  const zip = new JSZip();
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}</w:body></w:document>`,
  );
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  );
  await fs.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));
}

describe("alignParagraphLists", () => {
  it("pairs an in-place edit and does not zip a shifted equal-length list", () => {
    expect(alignParagraphLists(["甲", "乙旧"], ["甲", "乙新"])).toEqual([
      { kind: "pair", baseIndex: 0, otherIndex: 0 },
      { kind: "pair", baseIndex: 1, otherIndex: 1 },
    ]);
    expect(alignParagraphLists(["甲", "乙", "丙"], ["乙", "丙", "丁"])).toEqual([
      { kind: "base-only", baseIndex: 0 },
      { kind: "pair", baseIndex: 1, otherIndex: 0 },
      { kind: "pair", baseIndex: 2, otherIndex: 1 },
      { kind: "other-only", otherIndex: 2 },
    ]);
  });

  it("coalesces adjacent delete+insert into a substitution pair", () => {
    // Unequal lengths: middle paragraph replaced (乙→丁) plus a trailing insert.
    const aligned = alignParagraphLists(["甲", "乙", "丙"], ["甲", "丁", "丙", "戊"]);
    expect(aligned).toEqual([
      { kind: "pair", baseIndex: 0, otherIndex: 0 },
      { kind: "pair", baseIndex: 1, otherIndex: 1 },
      { kind: "pair", baseIndex: 2, otherIndex: 2 },
      { kind: "other-only", otherIndex: 3 },
    ]);
  });
});

describe("writeDocxCompareCopy", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-docx-compare-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes a sibling compare copy with tracked inserts/deletes", async () => {
    const base = path.join(dir, "原稿.docx");
    const other = path.join(dir, "改稿.docx");
    await writeMinimalDocx(base, ["甲方应于十日内付款。"]);
    await writeMinimalDocx(other, ["甲方应于五日内付款。"]);
    const result = await writeDocxCompareCopy({ baseAbs: base, otherAbs: other, author: "比较" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.changed).toBe(1);
    expect(result.outFileName).toBe("原稿_比较稿.docx");
    const zip = await JSZip.loadAsync(await fs.readFile(result.outAbs));
    const xml = await zip.file("word/document.xml")?.async("string");
    expect(xml).toMatch(/<w:del[\s\S]*十/);
    expect(xml).toMatch(/<w:ins[\s\S]*五/);
    expect(xml).toContain("日内付款");
  });
});
