import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentSha256FromFileVersion,
  validateFileReferencesAsync,
  type FileReference,
  type FileReferenceSource,
} from "./evidence-anchor.js";
import {
  readExcelRangeText,
  readPdfPageText,
  readRichLocatorText,
} from "./evidence-rich-locator.js";
import {
  checkEvidenceSupport,
  checkEvidenceSupportAsync,
  fileVersionOf,
} from "./evidence-support.js";

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-evidence-rich-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function write(ws: string, rel: string, bytes: Buffer | string): string {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  return abs;
}

/** 一页、Helvetica、纯 ASCII 的最小 PDF；用于验证页码文字层。 */
function makeTextPdf(text: string): Buffer {
  const safe = text.replace(/([()\\])/g, "\\$1");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(`BT /F1 24 Tf 72 720 Td (${safe}) Tj ET`)} >>\nstream\nBT /F1 24 Tf 72 720 Td (${safe}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function refFor(ws: string, rel: string, lineRef: string, text: string): FileReference {
  return { id: rel, filePath: rel, lineRef, text };
}

function sourceFor(ws: string, rel: string): FileReferenceSource {
  const sha = contentSha256FromFileVersion(fileVersionOf(path.join(ws, rel)));
  if (!sha) {
    throw new Error(`missing sha for ${rel}`);
  }
  return { path: rel, contentSha256: sha };
}

describe("PDF page anchors", () => {
  it("reads the page text layer and supports a matching quote", async () => {
    const ws = tmpWs();
    const rel = "cases/m/material.pdf";
    const abs = write(ws, rel, makeTextPdf("Hello LawMind"));
    const read = await readPdfPageText(abs, 1);
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.text).toContain("Hello LawMind");

    const support = await checkEvidenceSupportAsync({
      rootDir: ws,
      relPath: `${rel}#P1`,
      quote: "Hello LawMind",
    });
    expect(support.status).toBe("supported");

    const wrong = await checkEvidenceSupportAsync({
      rootDir: ws,
      relPath: `${rel}#P1`,
      quote: "Not on this page",
    });
    expect(wrong.status).toBe("quote_mismatch");
  });

  it("keeps a missing page or scanned page INCOMPLETE", async () => {
    const ws = tmpWs();
    const rel = "cases/m/material.pdf";
    const abs = write(ws, rel, makeTextPdf("Hello LawMind"));
    const page2 = await checkEvidenceSupportAsync({
      rootDir: ws,
      relPath: `${rel}#P2`,
      quote: "Hello LawMind",
    });
    expect(page2.status).toBe("unverifiable");
    expect(page2.reasonZh).toContain("第 2 页");

    const notPdf = await readRichLocatorText(abs, "cases/m/material.docx", {
      kind: "pdf_page",
      pageNumber: 1,
    });
    expect(notPdf.ok).toBe(false);
  });

  it("sync support stays INCOMPLETE for PDF anchors", async () => {
    const ws = tmpWs();
    const rel = "cases/m/material.pdf";
    write(ws, rel, makeTextPdf("Hello LawMind"));
    const support = checkEvidenceSupport({
      rootDir: ws,
      relPath: `${rel}#P1`,
      quote: "Hello LawMind",
    });
    expect(support.status).toBe("unverifiable");
  });
});

describe("Excel cell and range anchors", () => {
  async function writeWorkbook(ws: string, rel: string): Promise<string> {
    const abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("证据");
    sheet.getCell("A1").value = "合同编号";
    sheet.getCell("B1").value = "HT-2026-001";
    sheet.getCell("A2").value = 12345;
    sheet.getCell("B2").value = { formula: "A2*2" };
    sheet.getCell("C2").value = { formula: "A2*2", result: 24690 };
    await wb.xlsx.writeFile(abs);
    return abs;
  }

  it("reads a cell and a range, and supports quotes from both", async () => {
    const ws = tmpWs();
    const rel = "cases/m/证据表.xlsx";
    const abs = await writeWorkbook(ws, rel);

    const cell = await readExcelRangeText(abs, {
      kind: "excel_cell",
      sheetIndex: 1,
      cell: "B1",
    });
    expect(cell).toEqual({ ok: true, text: "HT-2026-001" });

    const range = await readExcelRangeText(abs, {
      kind: "excel_range",
      sheetIndex: 1,
      range: "A1:B1",
    });
    expect(range.ok).toBe(true);
    if (range.ok) {
      expect(range.text).toContain("合同编号");
      expect(range.text).toContain("HT-2026-001");
    }

    const cellSupport = await checkEvidenceSupportAsync({
      rootDir: ws,
      relPath: `${rel}#S1!B1`,
      quote: "HT-2026-001",
    });
    expect(cellSupport.status).toBe("supported");

    const rangeSupport = await checkEvidenceSupportAsync({
      rootDir: ws,
      relPath: `${rel}#S1!A1:B1`,
      quote: "合同编号 HT-2026-001",
    });
    expect(rangeSupport.status).toBe("supported");

    const wrong = await checkEvidenceSupportAsync({
      rootDir: ws,
      relPath: `${rel}#S1!B1`,
      quote: "HT-2025-999",
    });
    expect(wrong.status).toBe("quote_mismatch");
  });

  it("keeps a missing sheet or uncached formula INCOMPLETE", async () => {
    const ws = tmpWs();
    const rel = "cases/m/证据表.xlsx";
    await writeWorkbook(ws, rel);

    const missingSheet = await checkEvidenceSupportAsync({
      rootDir: ws,
      relPath: `${rel}#S2!A1`,
      quote: "合同编号",
    });
    expect(missingSheet.status).toBe("unverifiable");
    expect(missingSheet.reasonZh).toContain("工作表 2");

    const formula = await checkEvidenceSupportAsync({
      rootDir: ws,
      relPath: `${rel}#S1!B2`,
      quote: "24690",
    });
    expect(formula.status).toBe("unverifiable");
    expect(formula.reasonZh).toContain("未计算");

    const cached = await checkEvidenceSupportAsync({
      rootDir: ws,
      relPath: `${rel}#S1!C2`,
      quote: "24690",
    });
    expect(cached.status).toBe("supported");
  });
});

describe("validateFileReferencesAsync", () => {
  it("passes PDF and Excel anchors that can be re-read", async () => {
    const ws = tmpWs();
    const pdfRel = "cases/m/material.pdf";
    const xlsxRel = "cases/m/证据表.xlsx";
    write(ws, pdfRel, makeTextPdf("Hello LawMind"));
    const abs = path.join(ws, xlsxRel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("证据");
    sheet.getCell("B1").value = "HT-2026-001";
    await wb.xlsx.writeFile(abs);

    const result = await validateFileReferencesAsync({
      rootDir: ws,
      sourceFiles: [sourceFor(ws, pdfRel), sourceFor(ws, xlsxRel)],
      references: [
        refFor(ws, pdfRel, "P1", "Hello LawMind"),
        refFor(ws, xlsxRel, "S1!B1", "HT-2026-001"),
      ],
    });
    expect(result.status).toBe("PASSED");
    expect(result.summary).toMatchObject({ total: 2, passed: 2, failed: 0, incomplete: 0 });
  });

  it("fails a rewritten quote and keeps an unreadable file INCOMPLETE", async () => {
    const ws = tmpWs();
    const pdfRel = "cases/m/material.pdf";
    write(ws, pdfRel, makeTextPdf("Hello LawMind"));
    const failed = await validateFileReferencesAsync({
      rootDir: ws,
      sourceFiles: [sourceFor(ws, pdfRel)],
      references: [refFor(ws, pdfRel, "P1", "Hello someone else")],
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.issues[0]?.code).toBe("quote_mismatch");

    const emptyPdfRel = "cases/m/empty.pdf";
    write(ws, emptyPdfRel, makeTextPdf(""));
    const incomplete = await validateFileReferencesAsync({
      rootDir: ws,
      sourceFiles: [sourceFor(ws, emptyPdfRel)],
      references: [refFor(ws, emptyPdfRel, "P1", "anything")],
    });
    expect(incomplete.status).toBe("INCOMPLETE");
    expect(incomplete.issues[0]?.code).toBe("incomplete");
  });
});
