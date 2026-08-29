/**
 * Shared ExcelJS load/write with the same size caps as document ingest.
 */

import fs from "node:fs/promises";
import path from "node:path";

export const MAX_XLSX_READ_BYTES = 20_000_000;
export const MAX_XLSX_SHEETS = 32;
export const MAX_XLSX_ROWS_PER_SHEET = 5000;
export const MAX_XLSX_PREVIEW_ROWS = 8;
export const MAX_XLSX_WRITE_CELLS = 80_000;

export type XlsxCell = string | number | boolean | null;

export type XlsxSheetTable = {
  name: string;
  rows: XlsxCell[][];
  truncatedRows: boolean;
};

export type LoadedXlsxWorkbook = {
  sheets: XlsxSheetTable[];
  truncatedSheets: boolean;
};

function cellRaw(value: unknown, text: string): XlsxCell {
  if (value == null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const rec = value as { result?: unknown; text?: unknown; richText?: Array<{ text?: string }> };
    if (rec.result !== undefined) {
      return cellRaw(rec.result, text);
    }
    if (Array.isArray(rec.richText)) {
      const joined = rec.richText.map((t) => t.text ?? "").join("");
      return joined.trim() ? joined : null;
    }
  }
  const t = text.trim();
  if (!t) {
    return null;
  }
  const asNum = Number(t.replace(/,/g, ""));
  if (t !== "" && Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(t.replace(/,/g, ""))) {
    return asNum;
  }
  return t;
}

export async function loadXlsxWorkbook(filePath: string): Promise<LoadedXlsxWorkbook> {
  const st = await fs.stat(filePath);
  if (!st.isFile()) {
    throw new Error("不是文件");
  }
  if (st.size > MAX_XLSX_READ_BYTES) {
    throw new Error(`电子表格超过 ${Math.round(MAX_XLSX_READ_BYTES / 1_000_000)}MB 上限`);
  }
  const ExcelJS = await import("exceljs");
  const buffer = await fs.readFile(filePath);
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  await workbook.xlsx.load(arrayBuffer);
  const truncatedSheets = workbook.worksheets.length > MAX_XLSX_SHEETS;
  const sheets: XlsxSheetTable[] = [];
  for (const worksheet of workbook.worksheets.slice(0, MAX_XLSX_SHEETS)) {
    const rows: XlsxCell[][] = [];
    let truncatedRows = false;
    let rowCount = 0;
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      if (rowCount >= MAX_XLSX_ROWS_PER_SHEET) {
        truncatedRows = true;
        return;
      }
      const cells: XlsxCell[] = [];
      const maxCol = Math.max(row.cellCount, 1);
      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        cells.push(cellRaw(cell.value, String(cell.text ?? "")));
      }
      rows.push(cells);
      rowCount++;
    });
    sheets.push({ name: worksheet.name, rows, truncatedRows });
  }
  return { sheets, truncatedSheets };
}

export async function loadXlsxAsTsv(filePath: string): Promise<string> {
  const loaded = await loadXlsxWorkbook(filePath);
  const parts: string[] = [];
  for (const sheet of loaded.sheets) {
    const lines: string[] = [];
    for (const row of sheet.rows) {
      const cells = row.map((c) => (c == null ? "" : String(c)));
      if (cells.some((c) => c.trim())) {
        lines.push(cells.join("\t"));
      }
    }
    if (lines.length > 0) {
      parts.push(`### ${sheet.name}\n${lines.join("\n")}`);
    }
  }
  return parts.join("\n\n");
}

function asWriteCell(value: unknown): string | number | boolean {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value.slice(0, 2_000);
  }
  if (typeof value === "bigint" || typeof value === "symbol") {
    return value.toString().slice(0, 2_000);
  }
  try {
    return JSON.stringify(value).slice(0, 2_000);
  } catch {
    return "";
  }
}

export async function writeXlsxWorkbook(
  filePath: string,
  sheets: Array<{ name: string; rows: unknown[][] }>,
): Promise<void> {
  let cells = 0;
  for (const sheet of sheets) {
    cells += sheet.rows.reduce((n, row) => n + row.length, 0);
  }
  if (cells > MAX_XLSX_WRITE_CELLS) {
    throw new Error(`写出单元格数超过 ${MAX_XLSX_WRITE_CELLS} 上限`);
  }
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const used =
    sheets.length > 0 ? sheets.slice(0, MAX_XLSX_SHEETS) : [{ name: "Sheet1", rows: [] }];
  for (const sheet of used) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31) || "Sheet1");
    for (const row of sheet.rows.slice(0, MAX_XLSX_ROWS_PER_SHEET)) {
      ws.addRow(row.map((c) => asWriteCell(c)));
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await workbook.xlsx.writeFile(filePath);
}
