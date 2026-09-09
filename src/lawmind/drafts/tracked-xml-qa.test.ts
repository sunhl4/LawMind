import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { qaTrackedDocxXml } from "./tracked-xml-qa.js";

async function writeDocx(dir: string, documentXml: string): Promise<string> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types></Types>");
  zip.file("word/document.xml", documentXml);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const file = path.join(dir, "out.docx");
  await fs.writeFile(file, buf);
  return file;
}

describe("qaTrackedDocxXml", () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("passes when expected hunks have w:ins or w:del", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lm-xml-qa-"));
    const file = await writeDocx(
      tmp,
      `<w:document><w:body><w:ins w:id="1"><w:t>北京</w:t></w:ins><w:del w:id="2"><w:t>上海</w:t></w:del></w:body></w:document>`,
    );
    const qa = await qaTrackedDocxXml(file, 1);
    expect(qa.ok).toBe(true);
    expect(qa.insCount).toBe(1);
    expect(qa.delCount).toBe(1);
    expect(qa.warning).toBeUndefined();
  });

  it("warns when hunks were reported but XML has no marks", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lm-xml-qa-"));
    const file = await writeDocx(tmp, `<w:document><w:body><w:t>原文</w:t></w:body></w:document>`);
    const qa = await qaTrackedDocxXml(file, 2);
    expect(qa.ok).toBe(false);
    expect(qa.insCount + qa.delCount).toBe(0);
    expect(qa.warning).toMatch(/未见 w:ins\/w:del/);
  });

  it("does not fail an empty expected export", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lm-xml-qa-"));
    const file = await writeDocx(tmp, `<w:document><w:body><w:t>原文</w:t></w:body></w:document>`);
    const qa = await qaTrackedDocxXml(file, 0);
    expect(qa.ok).toBe(true);
  });
});
