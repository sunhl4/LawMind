import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { countPdfPages, renderPdfPagePng } from "./pdf-page.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeSimplePdf(filePath: string, text: string): void {
  const streamText = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET`;
  const streamLen = Buffer.byteLength(streamText, "utf8");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamText}\nendstream\nendobj\n`,
  ];
  const header = "%PDF-1.4\n";
  let body = "";
  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, "utf8");
  for (const obj of objects) {
    offsets.push(cursor);
    body += obj;
    cursor += Buffer.byteLength(obj, "utf8");
  }
  const xrefRows = offsets.map((off) => `${String(off).padStart(10, "0")} 00000 n `).join("\n");
  const trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefRows}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`;
  fs.writeFileSync(filePath, header + body + trailer, "binary");
}

describe("renderPdfPagePng", () => {
  it("renders one PDF page as a PNG", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pdf-page-"));
    tempDirs.push(dir);
    const file = path.join(dir, "合同.pdf");
    writeSimplePdf(file, "LawMind page");
    const png = await renderPdfPagePng(file, 1);
    expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(await countPdfPages(file)).toBe(1);
  });

  it("rejects a page number that was not named", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pdf-page-"));
    tempDirs.push(dir);
    const file = path.join(dir, "合同.pdf");
    writeSimplePdf(file, "LawMind page");
    await expect(renderPdfPagePng(file, 0)).rejects.toThrow("invalid_page");
  });

  it("rejects a pdf larger than 20MB before reading it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pdf-page-"));
    tempDirs.push(dir);
    const file = path.join(dir, "大.pdf");
    const fd = fs.openSync(file, "w");
    fs.ftruncateSync(fd, 20 * 1024 * 1024 + 1);
    fs.closeSync(fd);
    await expect(renderPdfPagePng(file, 1)).rejects.toThrow("pdf_too_large");
  });
});
