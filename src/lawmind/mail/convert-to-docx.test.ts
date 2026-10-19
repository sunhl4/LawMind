import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  CONVERTER_NEEDED_MESSAGE,
  WORD_CONVERT_FAILED_MESSAGE,
  convertLegacyDocForPreview,
  ensureDocxForAttachment,
} from "./convert-to-docx.js";
import { microsoftWordInstalled } from "./convert-with-word.js";
import { readBinaryWordDocText } from "./read-word-binary.js";

const FIXTURE = path.resolve(__dirname, "fixtures/tracked-changes-5-authors.doc");

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-conv-"));
}

async function writeDocx(abs: string): Promise<void> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>转换结果</w:t></w:r></w:p></w:body></w:document>`,
  );
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
  );
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));
}

describe("ensureDocxForAttachment", () => {
  it("returns an existing .docx unchanged", async () => {
    const ws = tmpWs();
    const rel = "cases/m1/mail/attachments/a/nda.docx";
    await writeDocx(path.join(ws, rel));
    const r = await ensureDocxForAttachment(ws, rel);
    expect(r).toEqual({
      ok: true,
      relativePath: rel,
      converted: false,
      fidelity: "high",
    });
  });

  it("rejects non-convertible formats", async () => {
    const ws = tmpWs();
    const rel = "cases/m1/mail/attachments/a/scan.pdf";
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "%PDF-1.4");
    const r = await ensureDocxForAttachment(ws, rel);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("not_convertible");
    }
  });

  it("copies misnamed OOXML bytes to .docx", async () => {
    const ws = tmpWs();
    const rel = "cases/m1/mail/attachments/a/misnamed.doc";
    await writeDocx(path.join(ws, rel));
    const r = await ensureDocxForAttachment(ws, rel);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.relativePath).toMatch(/\.docx$/i);
      expect(r.converted).toBe(true);
      expect(r.tool).toBe("zip-copy");
    }
  });

  it("never fakes fidelity: without a converter it asks for Word and leaves no .docx", async () => {
    const ws = tmpWs();
    const rel = "cases/m1/mail/attachments/a/施工合同.doc";
    const abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(FIXTURE, abs);

    // 有 Word 或 LibreOffice 时必须保真转换；都没有时必须失败并给明确指引。
    const r = await ensureDocxForAttachment(ws, rel);
    if (r.ok) {
      expect(["msword", "soffice"]).toContain(r.tool);
      expect(r.fidelity).toBe("high");
      const zip = await JSZip.loadAsync(fs.readFileSync(path.join(ws, r.relativePath)));
      expect(Object.hasOwn(zip.files, "word/document.xml")).toBe(true);
      return;
    }
    expect(r.error).toBe(
      microsoftWordInstalled() ? WORD_CONVERT_FAILED_MESSAGE : CONVERTER_NEEDED_MESSAGE,
    );
    expect(fs.existsSync(path.join(ws, rel.replace(/\.doc$/i, ".docx")))).toBe(false);
  });
});

describe("convertLegacyDocForPreview", () => {
  it("reads text in-process and reports text-only fidelity", async () => {
    const ws = tmpWs();
    const rel = "施工合同.doc";
    fs.copyFileSync(FIXTURE, path.join(ws, rel));
    const r = await convertLegacyDocForPreview(ws, rel);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 预览不产文件、不冒充保真。
      expect(r.relativePath).toBe(rel);
      expect(r.fidelity).toBe("text-only");
    }
    expect(fs.existsSync(path.join(ws, "施工合同.docx"))).toBe(false);
    const text = await readBinaryWordDocText(path.join(ws, rel));
    expect(text).toContain("履约保函");
  });
});
