/**
 * Evidence locator parse/format (MeWork-compatible lineRef shapes).
 * Kept free of I/O so evidence-support and validateFileReferences can share it.
 */

export type EvidenceLocator =
  | { kind: "line"; start: number; end: number }
  | { kind: "docx_paragraph"; paragraphIndex: number }
  | { kind: "pdf_page"; pageNumber: number }
  | { kind: "excel_cell"; sheetIndex: number; cell: string }
  | { kind: "excel_range"; sheetIndex: number; range: string };

const LINE_RE = /^(?:line=|L)([1-9]\d*)(?:[-:](?:L)?([1-9]\d*))?$/i;
const DOCX_RE = /^L([1-9]\d*)$/;
const PDF_RE = /^P([1-9]\d*)$/;
const EXCEL_RANGE_RE = /^S([1-9]\d*)!([A-Z]+[1-9]\d*:[A-Z]+[1-9]\d*)$/i;
const EXCEL_CELL_RE = /^S([1-9]\d*)!([A-Z]+[1-9]\d*)$/i;

export function parseEvidenceLocator(raw: string): EvidenceLocator | null {
  const s = raw.trim();
  if (!s) {
    return null;
  }
  const excelRange = EXCEL_RANGE_RE.exec(s);
  if (excelRange) {
    return {
      kind: "excel_range",
      sheetIndex: Number(excelRange[1]),
      range: (excelRange[2] ?? "").toUpperCase(),
    };
  }
  const excelCell = EXCEL_CELL_RE.exec(s);
  if (excelCell) {
    return {
      kind: "excel_cell",
      sheetIndex: Number(excelCell[1]),
      cell: (excelCell[2] ?? "").toUpperCase(),
    };
  }
  const pdf = PDF_RE.exec(s);
  if (pdf) {
    return { kind: "pdf_page", pageNumber: Number(pdf[1]) };
  }
  const docx = DOCX_RE.exec(s);
  if (docx) {
    return { kind: "docx_paragraph", paragraphIndex: Number(docx[1]) };
  }
  const line = LINE_RE.exec(s);
  if (line) {
    const start = Number(line[1]);
    const end = Number(line[2] ?? start);
    if (end < start) {
      return null;
    }
    return { kind: "line", start, end };
  }
  return null;
}

export function formatEvidenceLocator(locator: EvidenceLocator): string {
  switch (locator.kind) {
    case "line":
      return locator.start === locator.end
        ? `L${locator.start}`
        : `L${locator.start}-L${locator.end}`;
    case "docx_paragraph":
      return `L${locator.paragraphIndex}`;
    case "pdf_page":
      return `P${locator.pageNumber}`;
    case "excel_cell":
      return `S${locator.sheetIndex}!${locator.cell}`;
    case "excel_range":
      return `S${locator.sheetIndex}!${locator.range}`;
    default: {
      const exhaustive: never = locator;
      return exhaustive;
    }
  }
}

export function splitPathAndLocator(relPath: string): { path: string; locator: string | null } {
  const trimmed = relPath.trim();
  const hash = trimmed.indexOf("#");
  if (hash < 0) {
    return { path: trimmed, locator: null };
  }
  return {
    path: trimmed.slice(0, hash),
    locator: trimmed.slice(hash + 1).trim() || null,
  };
}

export function locatorNeedsRichParser(locator: EvidenceLocator): boolean {
  return (
    locator.kind === "pdf_page" || locator.kind === "excel_cell" || locator.kind === "excel_range"
  );
}

export function locatorPlainTextLineRange(
  locator: EvidenceLocator,
): { start: number; end: number } | null {
  if (locator.kind === "line") {
    return { start: locator.start, end: locator.end };
  }
  if (locator.kind === "docx_paragraph") {
    return { start: locator.paragraphIndex, end: locator.paragraphIndex };
  }
  return null;
}
