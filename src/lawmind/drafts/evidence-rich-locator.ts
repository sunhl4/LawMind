/**
 * 富定位读取器：PDF 页码、Excel 单元格/范围。
 *
 * 目的：把 `P2`、`S1!B4` 从「已解析但未核对」推进到「能重新读取原文」。
 * 读不出来（扫描件无文字层、加密、超大、公式无缓存值、工作表不存在）
 * 一律返回 `ok: false`；调用方必须保持 `INCOMPLETE`，不得当作通过。
 *
 * 只做定位读取，不做语义判断；页内文字顺序仍由 PDF 文本层决定。
 */

import fs from "node:fs/promises";
import type { EvidenceLocator } from "./evidence-locator.js";

export type RichLocatorText = { ok: true; text: string } | { ok: false; reason: string };

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_XLSX_BYTES = 20 * 1024 * 1024;
const MAX_RANGE_CELLS = 20_000;
const MAX_RANGE_ROWS = 5_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isPdfPath(rel: string): boolean {
  return /\.pdf$/i.test(rel);
}

function isXlsxPath(rel: string): boolean {
  return /\.(xlsx|xlsm)$/i.test(rel);
}

/** 读 PDF 的一页文字层；不渲染、不做 OCR。 */
export async function readPdfPageText(
  absPath: string,
  pageNumber: number,
): Promise<RichLocatorText> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return { ok: false, reason: "页码必须是正整数。" };
  }
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return { ok: false, reason: "PDF 文件不存在或无法读取。" };
  }
  if (!stat.isFile() || stat.size > MAX_PDF_BYTES) {
    return { ok: false, reason: "PDF 超过 20MB 或不是普通文件，本次未核对。" };
  }
  let data: Buffer;
  try {
    data = await fs.readFile(absPath);
  } catch {
    return { ok: false, reason: "读取 PDF 失败，本次未核对。" };
  }
  let parser: { destroy: () => Promise<void> } | undefined;
  try {
    const mod = await import("pdf-parse");
    const instance = new mod.PDFParse({ data });
    parser = instance;
    const result = await instance.getText({ partial: [pageNumber] });
    const page = result.pages.find((item) => item.num === pageNumber);
    if (!page) {
      return {
        ok: false,
        reason: `PDF 没有第 ${pageNumber} 页（共 ${result.total} 页）。`,
      };
    }
    if (!page.text.trim()) {
      return {
        ok: false,
        reason: `第 ${pageNumber} 页没有可提取文字（可能是扫描件），本次未核对。`,
      };
    }
    return { ok: true, text: page.text };
  } catch (err) {
    return { ok: false, reason: `PDF 解析失败：${errorMessage(err).slice(0, 160)}` };
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

type ExcelJsNamespace = typeof import("exceljs");

function resolveExcelJs(mod: unknown): ExcelJsNamespace {
  const rec = mod as { Workbook?: unknown; default?: { Workbook?: unknown } };
  if (typeof rec.Workbook === "function") {
    return rec as ExcelJsNamespace;
  }
  if (rec.default && typeof rec.default.Workbook === "function") {
    return rec.default as ExcelJsNamespace;
  }
  throw new Error("exceljs_workbook_missing");
}

/** 单元格值 → 文本。公式取缓存结果；富文本拼接；日期用 ISO。 */
function cellToText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return String(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const rec = value as {
      result?: unknown;
      text?: unknown;
      error?: unknown;
      richText?: Array<{ text?: string }>;
      formula?: unknown;
    };
    if (Array.isArray(rec.richText)) {
      return rec.richText.map((part) => part.text ?? "").join("");
    }
    if ("result" in rec) {
      return cellToText(rec.result);
    }
    if (typeof rec.text === "string") {
      return rec.text;
    }
    if (typeof rec.error === "string") {
      return rec.error;
    }
    if (rec.formula !== undefined) {
      return "";
    }
  }
  return "";
}

function formulaWithoutResult(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const rec = value as { formula?: unknown; result?: unknown };
  return rec.formula !== undefined && rec.result === undefined;
}

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    const code = ch.charCodeAt(0) - 64;
    if (code < 1 || code > 26) {
      return 0;
    }
    n = n * 26 + code;
  }
  return n;
}

function parseA1(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)([1-9]\d*)$/.exec(ref.trim());
  if (!m) {
    return null;
  }
  const col = columnNumber(m[1] ?? "");
  const row = Number(m[2]);
  return col > 0 && Number.isInteger(row) ? { row, col } : null;
}

async function loadSheet(absPath: string, sheetIndex: number) {
  const stat = await fs.stat(absPath);
  if (!stat.isFile() || stat.size > MAX_XLSX_BYTES) {
    throw new Error("电子表格超过 20MB 或不是普通文件");
  }
  const ExcelJS = resolveExcelJs(await import("exceljs"));
  const buffer = await fs.readFile(absPath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[sheetIndex - 1];
  if (!sheet) {
    throw new Error(`工作表 ${sheetIndex} 不存在（共 ${workbook.worksheets.length} 个）`);
  }
  return sheet;
}

/** 读单元格/范围的文本；范围按「行用换行、列用制表符」拼接。 */
export async function readExcelRangeText(
  absPath: string,
  locator: Extract<EvidenceLocator, { kind: "excel_cell" | "excel_range" }>,
): Promise<RichLocatorText> {
  let sheet;
  try {
    sheet = await loadSheet(absPath, locator.sheetIndex);
  } catch (err) {
    return { ok: false, reason: `Excel 无法读取：${errorMessage(err).slice(0, 160)}` };
  }
  if (locator.kind === "excel_cell") {
    const at = parseA1(locator.cell);
    if (!at) {
      return { ok: false, reason: `单元格地址无效：${locator.cell}` };
    }
    const cell = sheet.getCell(at.row, at.col);
    if (formulaWithoutResult(cell.value)) {
      return { ok: false, reason: "该单元格是未计算公式，且没有缓存结果，本次未核对。" };
    }
    return { ok: true, text: cellToText(cell.value) };
  }

  const [startRaw, endRaw] = locator.range.split(":");
  const start = parseA1(startRaw ?? "");
  const end = parseA1(endRaw ?? "");
  if (!start || !end || end.row < start.row || end.col < start.col) {
    return { ok: false, reason: `单元格范围无效：${locator.range}` };
  }
  const rows = end.row - start.row + 1;
  const cols = end.col - start.col + 1;
  if (rows > MAX_RANGE_ROWS || rows * cols > MAX_RANGE_CELLS) {
    return {
      ok: false,
      reason: `引用范围过大（${rows} 行 × ${cols} 列），本次未核对。`,
    };
  }
  const lines: string[] = [];
  for (let r = start.row; r <= end.row; r += 1) {
    const cells: string[] = [];
    for (let c = start.col; c <= end.col; c += 1) {
      const cell = sheet.getCell(r, c);
      if (formulaWithoutResult(cell.value)) {
        return { ok: false, reason: "范围内含未计算公式且没有缓存结果，本次未核对。" };
      }
      cells.push(cellToText(cell.value));
    }
    lines.push(cells.join("\t"));
  }
  return { ok: true, text: lines.join("\n") };
}

/** 按扩展名与定位类型分派；不支持的类型返回未核对原因。 */
export async function readRichLocatorText(
  absPath: string,
  relPath: string,
  locator: EvidenceLocator,
): Promise<RichLocatorText> {
  if (locator.kind === "pdf_page") {
    if (!isPdfPath(relPath)) {
      return { ok: false, reason: "页定位（P{n}）只能用于 PDF 文件。" };
    }
    return readPdfPageText(absPath, locator.pageNumber);
  }
  if (locator.kind === "excel_cell" || locator.kind === "excel_range") {
    if (!isXlsxPath(relPath)) {
      return { ok: false, reason: "单元格定位（S{n}!A1）只能用于 XLSX 文件。" };
    }
    return readExcelRangeText(absPath, locator);
  }
  return { ok: false, reason: "不是富文本定位。" };
}
