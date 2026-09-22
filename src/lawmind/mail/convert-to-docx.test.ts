import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDocxForAttachment } from "./convert-to-docx.js";

describe("ensureDocxForAttachment", () => {
  it("returns existing docx unchanged", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-conv-"));
    const rel = "cases/m1/mail/attachments/a/nda.docx";
    const abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "PK\x03\x04fake");
    const r = await ensureDocxForAttachment(ws, rel);
    expect(r).toEqual({
      ok: true,
      relativePath: rel,
      converted: false,
      fidelity: "high",
    });
  });

  it("rejects non-convertible formats", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-conv-"));
    const rel = "cases/m1/mail/attachments/a/scan.pdf";
    const abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "%PDF-1.4");
    const r = await ensureDocxForAttachment(ws, rel);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("not_convertible");
    }
  });

  it("copies misnamed zip/docx bytes to .docx", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-conv-"));
    const rel = "cases/m1/mail/attachments/a/misnamed.doc";
    const abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // Minimal ZIP local-file header signature
    fs.writeFileSync(abs, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]));
    const r = await ensureDocxForAttachment(ws, rel);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.relativePath).toMatch(/\.docx$/i);
      expect(r.converted).toBe(true);
      expect(fs.existsSync(path.join(ws, r.relativePath))).toBe(true);
    }
  });
});
