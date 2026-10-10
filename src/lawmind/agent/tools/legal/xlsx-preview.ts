/**
 * Excel-like UI preview payload (styles, merges, column widths).
 * Value-only ingest stays in xlsx-workbook.ts for the agent.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { ensureLocalFile } from "../../../runtime/icloud-materialize.js";
import {
  cellRaw,
  importExcelJsForPreview,
  MAX_XLSX_READ_BYTES,
  MAX_XLSX_ROWS_PER_SHEET,
  MAX_XLSX_SHEETS,
  type XlsxCell,
} from "./xlsx-workbook.js";

export const MAX_XLSX_PREVIEW_COLS = 64;

export type XlsxPreviewBorderSide = {
  style: string;
  color?: string;
};

export type XlsxPreviewCellStyle = {
  bg?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontName?: string;
  hAlign?: "left" | "center" | "right" | "justify" | "fill";
  vAlign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  border?: {
    t?: XlsxPreviewBorderSide;
    r?: XlsxPreviewBorderSide;
    b?: XlsxPreviewBorderSide;
    l?: XlsxPreviewBorderSide;
  };
};

/** null = covered by a merge master (omit from <td>). */
export type XlsxPreviewCell = {
  v: XlsxCell;
  s?: XlsxPreviewCellStyle;
  rs?: number;
  cs?: number;
} | null;

export type XlsxPreviewSheet = {
  name: string;
  colCount: number;
  /** Pixel widths for data columns (1..colCount). */
  colWidthsPx: number[];
  /** Pixel heights per row; null = default. */
  rowHeightsPx: Array<number | null>;
  cells: XlsxPreviewCell[][];
  truncatedRows: boolean;
};

export type LoadedXlsxPreview = {
  sheets: XlsxPreviewSheet[];
  truncatedSheets: boolean;
};

type ThemePalette = string[];

/** SpreadsheetML theme index → DrawingML clrScheme slot. */
const SPREADSHEET_THEME_TO_SCHEME = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11] as const;

function parseThemePalette(themeXml: string | undefined): ThemePalette {
  const fallback = [
    "000000",
    "FFFFFF",
    "0E2841",
    "E8E8E8",
    "156082",
    "E97132",
    "196B24",
    "0F9ED5",
    "A02B93",
    "4EA72E",
    "0563C1",
    "954F72",
  ];
  if (!themeXml) {
    return fallback;
  }
  const scheme = themeXml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/i)?.[0] ?? "";
  const slots = [
    "dk1",
    "lt1",
    "dk2",
    "lt2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
  ];
  const out = [...fallback];
  for (let i = 0; i < slots.length; i++) {
    const block = scheme.match(new RegExp(`<a:${slots[i]}>([\\s\\S]*?)</a:${slots[i]}>`, "i"))?.[1];
    if (!block) {
      continue;
    }
    const srgb = block.match(/srgbClr[^>]*val="([0-9A-Fa-f]{6})"/i)?.[1];
    const sys = block.match(/sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/i)?.[1];
    const hex = (srgb ?? sys)?.toUpperCase();
    if (hex) {
      out[i] = hex;
    }
  }
  return out;
}

function applyTint(hex: string, tint: number | undefined): string {
  if (tint == null || !Number.isFinite(tint) || tint === 0) {
    return hex;
  }
  const n = parseInt(hex, 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  if (tint < 0) {
    const t = tint + 1;
    r = Math.round(r * t);
    g = Math.round(g * t);
    b = Math.round(b * t);
  } else {
    r = Math.round(r + (255 - r) * tint);
    g = Math.round(g + (255 - g) * tint);
    b = Math.round(b + (255 - b) * tint);
  }
  return [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");
}

function resolveColor(color: unknown, theme: ThemePalette): string | undefined {
  if (!color || typeof color !== "object") {
    return undefined;
  }
  const rec = color as { argb?: string; theme?: number; tint?: number };
  if (typeof rec.argb === "string" && rec.argb.length >= 6) {
    const rgb = rec.argb.length === 8 ? rec.argb.slice(2) : rec.argb.slice(0, 6);
    return `#${applyTint(rgb.toUpperCase(), rec.tint)}`;
  }
  if (typeof rec.theme === "number" && rec.theme >= 0) {
    const schemeIndex = SPREADSHEET_THEME_TO_SCHEME[rec.theme] ?? rec.theme;
    const base = theme[schemeIndex] ?? theme[0] ?? "000000";
    return `#${applyTint(base, rec.tint)}`;
  }
  return undefined;
}

function excelColWidthToPx(width: number | undefined): number {
  if (width == null || !Number.isFinite(width) || width <= 0) {
    return 64;
  }
  // Excel character-width → CSS px (approx. Calibri 11).
  return Math.max(24, Math.round(width * 7 + 5));
}

function excelRowHeightToPx(height: number | undefined): number | null {
  if (height == null || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return Math.max(16, Math.round((height * 96) / 72));
}

function parseMergeRange(range: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(range.trim());
  if (!m) {
    return null;
  }
  const col = (letters: string) => {
    let n = 0;
    for (const ch of letters.toUpperCase()) {
      n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n;
  };
  return {
    r1: Number(m[2]),
    c1: col(m[1] ?? "A"),
    r2: Number(m[4]),
    c2: col(m[3] ?? "A"),
  };
}

function borderSide(side: unknown, theme: ThemePalette): XlsxPreviewBorderSide | undefined {
  if (!side || typeof side !== "object") {
    return undefined;
  }
  const rec = side as { style?: string; color?: unknown };
  if (!rec.style || rec.style === "none") {
    return undefined;
  }
  const color = resolveColor(rec.color, theme);
  return color ? { style: rec.style, color } : { style: rec.style };
}

function extractStyle(
  cell: {
    fill?: unknown;
    font?: unknown;
    alignment?: unknown;
    border?: unknown;
  },
  theme: ThemePalette,
): XlsxPreviewCellStyle | undefined {
  const style: XlsxPreviewCellStyle = {};
  const fill = cell.fill as
    | { type?: string; pattern?: string; fgColor?: unknown; bgColor?: unknown }
    | undefined;
  if (fill && fill.pattern && fill.pattern !== "none") {
    const bg = resolveColor(fill.fgColor ?? fill.bgColor, theme);
    if (bg) {
      style.bg = bg;
    }
  }
  const font = cell.font as
    | {
        bold?: boolean;
        italic?: boolean;
        underline?: boolean | string;
        size?: number;
        name?: string;
        color?: unknown;
      }
    | undefined;
  if (font) {
    if (font.bold) {
      style.bold = true;
    }
    if (font.italic) {
      style.italic = true;
    }
    if (font.underline) {
      style.underline = true;
    }
    if (typeof font.size === "number" && Number.isFinite(font.size)) {
      style.fontSize = font.size;
    }
    if (typeof font.name === "string" && font.name.trim()) {
      style.fontName = font.name.trim();
    }
    const color = resolveColor(font.color, theme);
    if (color && color.toLowerCase() !== "#000000") {
      style.color = color;
    }
  }
  const alignment = cell.alignment as
    | {
        horizontal?: string;
        vertical?: string;
        wrapText?: boolean;
      }
    | undefined;
  if (alignment) {
    if (
      alignment.horizontal === "left" ||
      alignment.horizontal === "center" ||
      alignment.horizontal === "right" ||
      alignment.horizontal === "justify" ||
      alignment.horizontal === "fill"
    ) {
      style.hAlign = alignment.horizontal;
    }
    if (
      alignment.vertical === "top" ||
      alignment.vertical === "middle" ||
      alignment.vertical === "bottom"
    ) {
      style.vAlign = alignment.vertical;
    }
    if (alignment.wrapText) {
      style.wrap = true;
    }
  }
  const border = cell.border as Record<string, unknown> | undefined;
  if (border) {
    const b: NonNullable<XlsxPreviewCellStyle["border"]> = {};
    const t = borderSide(border.top, theme);
    const r = borderSide(border.right, theme);
    const bottom = borderSide(border.bottom, theme);
    const l = borderSide(border.left, theme);
    if (t) {
      b.t = t;
    }
    if (r) {
      b.r = r;
    }
    if (bottom) {
      b.b = bottom;
    }
    if (l) {
      b.l = l;
    }
    if (b.t || b.r || b.b || b.l) {
      style.border = b;
    }
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

export async function loadXlsxUiPreview(filePath: string): Promise<LoadedXlsxPreview> {
  const st = await fs.stat(filePath);
  if (!st.isFile()) {
    throw new Error("不是文件");
  }
  if (st.size > MAX_XLSX_READ_BYTES) {
    throw new Error(`电子表格超过 ${Math.round(MAX_XLSX_READ_BYTES / 1_000_000)}MB 上限`);
  }
  const ExcelJS = await importExcelJsForPreview();
  await ensureLocalFile(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const themeXml = (workbook as { ["_themes"]?: { theme1?: string } })["_themes"]?.theme1;
  const theme = parseThemePalette(themeXml);
  const truncatedSheets = workbook.worksheets.length > MAX_XLSX_SHEETS;
  const sheets: XlsxPreviewSheet[] = [];

  for (const worksheet of workbook.worksheets.slice(0, MAX_XLSX_SHEETS)) {
    const dim = worksheet.dimensions;
    const rowEnd = Math.min(
      MAX_XLSX_ROWS_PER_SHEET,
      Math.max(dim?.bottom ?? worksheet.rowCount ?? 1, 1),
    );
    const truncatedRows = (dim?.bottom ?? worksheet.rowCount ?? 0) > MAX_XLSX_ROWS_PER_SHEET;
    const colEnd = Math.min(
      MAX_XLSX_PREVIEW_COLS,
      Math.max(dim?.right ?? worksheet.columnCount ?? 1, 1),
    );

    const mergeMaster = new Map<string, { rs: number; cs: number }>();
    const covered = new Set<string>();
    const merges = (worksheet as { model?: { merges?: string[] } }).model?.merges ?? [];

    for (const range of merges) {
      const parsed = parseMergeRange(range);
      if (!parsed) {
        continue;
      }
      const { r1, c1, r2, c2 } = parsed;
      if (r1 > rowEnd || c1 > colEnd) {
        continue;
      }
      const rs = Math.min(r2, rowEnd) - r1 + 1;
      const cs = Math.min(c2, colEnd) - c1 + 1;
      mergeMaster.set(`${r1}:${c1}`, { rs, cs });
      for (let r = r1; r <= Math.min(r2, rowEnd); r++) {
        for (let c = c1; c <= Math.min(c2, colEnd); c++) {
          if (r === r1 && c === c1) {
            continue;
          }
          covered.add(`${r}:${c}`);
        }
      }
    }

    const colWidthsPx: number[] = [];
    for (let c = 1; c <= colEnd; c++) {
      colWidthsPx.push(excelColWidthToPx(worksheet.getColumn(c).width));
    }

    const rowHeightsPx: Array<number | null> = [];
    const cells: XlsxPreviewCell[][] = [];
    for (let r = 1; r <= rowEnd; r++) {
      rowHeightsPx.push(excelRowHeightToPx(worksheet.getRow(r).height));
      const rowCells: XlsxPreviewCell[] = [];
      for (let c = 1; c <= colEnd; c++) {
        const key = `${r}:${c}`;
        if (covered.has(key)) {
          rowCells.push(null);
          continue;
        }
        const cell = worksheet.getCell(r, c);
        const span = mergeMaster.get(key);
        const s = extractStyle(cell, theme);
        const entry: NonNullable<XlsxPreviewCell> = { v: cellRaw(cell.value) };
        if (s) {
          entry.s = s;
        }
        if (span && span.rs > 1) {
          entry.rs = span.rs;
        }
        if (span && span.cs > 1) {
          entry.cs = span.cs;
        }
        rowCells.push(entry);
      }
      cells.push(rowCells);
    }

    sheets.push({
      name: worksheet.name,
      colCount: colEnd,
      colWidthsPx,
      rowHeightsPx,
      cells,
      truncatedRows,
    });
  }

  return { sheets, truncatedSheets };
}

export const MAX_XLSX_CELL_EDITS = 8_000;

export type XlsxCellEdit = {
  /** Worksheet name (exact). */
  sheet: string;
  /** 1-based row / column. */
  row: number;
  col: number;
  value: XlsxCell;
};

function coerceWriteValue(value: XlsxCell): string | number | boolean | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const t = String(value);
  if (!t.trim()) {
    return null;
  }
  return t.slice(0, 8_000);
}

/**
 * Patch cell values in-place and write the workbook back.
 * Styles / merges / other sheets are preserved by ExcelJS round-trip.
 *
 * Callers that already ran ensureLocalFile (and mtime checks) should pass
 * `skipEnsureLocal: true` so materialize cannot change mtime after the check.
 */
export async function applyXlsxCellEdits(
  filePath: string,
  edits: XlsxCellEdit[],
  options?: { skipEnsureLocal?: boolean },
): Promise<{ applied: number }> {
  if (edits.length === 0) {
    return { applied: 0 };
  }
  if (edits.length > MAX_XLSX_CELL_EDITS) {
    throw new Error(`一次最多改 ${MAX_XLSX_CELL_EDITS} 个单元格`);
  }
  const st = await fs.stat(filePath);
  if (!st.isFile()) {
    throw new Error("不是文件");
  }
  if (st.size > MAX_XLSX_READ_BYTES) {
    throw new Error(`电子表格超过 ${Math.round(MAX_XLSX_READ_BYTES / 1_000_000)}MB 上限`);
  }
  const ExcelJS = await importExcelJsForPreview();
  if (!options?.skipEnsureLocal) {
    await ensureLocalFile(filePath);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  let applied = 0;
  for (const edit of edits) {
    const sheetName = edit.sheet.trim();
    if (!sheetName) {
      continue;
    }
    if (
      !Number.isInteger(edit.row) ||
      !Number.isInteger(edit.col) ||
      edit.row < 1 ||
      edit.col < 1 ||
      edit.row > MAX_XLSX_ROWS_PER_SHEET ||
      edit.col > MAX_XLSX_PREVIEW_COLS
    ) {
      throw new Error(`单元格坐标无效：${sheetName}!R${edit.row}C${edit.col}`);
    }
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) {
      throw new Error(`找不到工作表「${sheetName}」`);
    }
    const cell = ws.getCell(edit.row, edit.col);
    cell.value = coerceWriteValue(edit.value);
    applied += 1;
  }
  // WeChat / mail downloads often land as mode 0444. ExcelJS writeFile opens the
  // path for write and gets EACCES; write to a sibling temp then rename over it.
  await writeXlsxReplacingReadonly(workbook, filePath);
  return { applied };
}

async function writeXlsxReplacingReadonly(
  workbook: { xlsx: { writeFile: (p: string) => Promise<void> } },
  filePath: string,
): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp.xlsx`);
  try {
    await workbook.xlsx.writeFile(tmp);
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    const code = err && typeof err === "object" ? (err as { code?: string }).code : undefined;
    if (code === "EACCES" || code === "EPERM") {
      // Last resort: clear owner write bit, write in place, keep other mode bits.
      try {
        const st = await fs.stat(filePath);
        if (!(st.mode & 0o200)) {
          await fs.chmod(filePath, st.mode | 0o200);
        }
        await workbook.xlsx.writeFile(filePath);
        return;
      } catch {
        throw new Error(
          "没有写入权限：文件可能是只读的，或正被 Excel/WPS 打开。请先关闭本机应用，或在访达中去掉「锁定」后再保存。",
        );
      }
    }
    throw err;
  }
}
