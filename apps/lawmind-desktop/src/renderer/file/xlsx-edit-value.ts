/** Coerce in-grid typed text to a cell value for save / local state. */

export type XlsxEditValue = string | number | boolean | null;

export function parseXlsxEditInput(raw: string): XlsxEditValue {
  const t = raw.trim();
  if (!t) {
    return null;
  }
  if (t === "TRUE" || t === "true") {
    return true;
  }
  if (t === "FALSE" || t === "false") {
    return false;
  }
  const compact = t.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(compact)) {
    const n = Number(compact);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return raw;
}

export function formatXlsxEditValue(value: XlsxEditValue | undefined): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return String(value);
}
