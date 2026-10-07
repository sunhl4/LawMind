import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  nextDispositionIds,
  parseDispositionXml,
  serializeDispositionXml,
  trackIdsInDocumentXml,
} from "./disposition.ts";
import { loadDocxStories, saveParagraphRuns } from "./document.ts";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("disposition part", () => {
  it("round-trips accepted ids without removing w:ins", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-disposition-"));
    dirs.push(dir);
    const abs = path.join(dir, "合同.docx");
    const documentXml =
      `<?xml version="1.0"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:ins w:id="2" w:author="国浩-吕盈修"><w:r><w:t>五日</w:t></w:r></w:ins></w:p>` +
      `</w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", documentXml);
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`,
    );
    zip.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    );
    await fs.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));
    const saved = await saveParagraphRuns({
      absPath: abs,
      paragraphs: [
        [
          {
            text: "五日",
            track: { kind: "ins", id: "2", author: "国浩-吕盈修", disposition: "accepted" },
          },
        ],
      ],
    });
    expect(saved.ok).toBe(true);
    const again = await JSZip.loadAsync(await fs.readFile(abs));
    const xml = (await again.file("word/document.xml")?.async("string")) ?? "";
    expect(xml).toContain("<w:ins ");
    expect(xml).toContain('w:author="国浩-吕盈修"');
    expect(xml).not.toContain("disposition");
    const part = (await again.file("word/lawmind-disposition.xml")?.async("string")) ?? "";
    expect(parseDispositionXml(part)).toEqual(["2"]);
    const loaded = await loadDocxStories(abs);
    expect(loaded.acceptedRevIds).toEqual(["2"]);
  });

  it("drops a rejected body id and keeps an id from another story", () => {
    const xml = `<w:ins w:id="2" w:author="甲"><w:r><w:t>五</w:t></w:r></w:ins>`;
    const next = nextDispositionIds({
      previousAccepted: ["2", "9"],
      previousStoryIds: trackIdsInDocumentXml(xml),
      paragraphs: [
        [{ text: "日", track: { kind: "ins", id: "3", author: "甲", disposition: "accepted" } }],
      ],
    });
    expect(next).toEqual(["9", "3"]);
    expect(serializeDispositionXml(next)).toContain("<id>9</id>");
  });
});
