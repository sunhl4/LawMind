/**
 * Map ExcelJS-exported cell styles → CSS (Excel/WPS-like grid).
 */

import type { CSSProperties } from "react";

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

const BORDER_WIDTH: Record<string, string> = {
  hair: "1px",
  thin: "1px",
  medium: "2px",
  thick: "3px",
  dotted: "1px",
  dashed: "1px",
  dashDot: "1px",
  dashDotDot: "1px",
  mediumDashed: "2px",
  mediumDashDot: "2px",
  mediumDashDotDot: "2px",
  slantDashDot: "1px",
  double: "3px",
};

const BORDER_STYLE: Record<string, string> = {
  hair: "solid",
  thin: "solid",
  medium: "solid",
  thick: "solid",
  dotted: "dotted",
  dashed: "dashed",
  dashDot: "dashed",
  dashDotDot: "dashed",
  mediumDashed: "dashed",
  mediumDashDot: "dashed",
  mediumDashDotDot: "dashed",
  slantDashDot: "dashed",
  double: "double",
};

const DEFAULT_GRID = "1px solid #d0d7de";
const DEFAULT_BORDER_COLOR = "#000000";

function cssBorder(side: XlsxPreviewBorderSide | undefined): string {
  if (!side?.style) {
    return DEFAULT_GRID;
  }
  const width = BORDER_WIDTH[side.style] ?? "1px";
  const style = BORDER_STYLE[side.style] ?? "solid";
  const color = side.color ?? DEFAULT_BORDER_COLOR;
  return `${width} ${style} ${color}`;
}

export function cellStyleToCss(style: XlsxPreviewCellStyle | undefined): CSSProperties {
  const css: CSSProperties = {
    borderTop: DEFAULT_GRID,
    borderRight: DEFAULT_GRID,
    borderBottom: DEFAULT_GRID,
    borderLeft: DEFAULT_GRID,
  };
  if (!style) {
    return css;
  }
  if (style.bg) {
    css.backgroundColor = style.bg;
  }
  if (style.color) {
    css.color = style.color;
  }
  if (style.bold) {
    css.fontWeight = 700;
  }
  if (style.italic) {
    css.fontStyle = "italic";
  }
  if (style.underline) {
    css.textDecoration = "underline";
  }
  if (style.fontSize) {
    css.fontSize = `${style.fontSize}pt`;
  }
  if (style.fontName) {
    css.fontFamily = `"${style.fontName}", "PingFang SC", "Microsoft YaHei", sans-serif`;
  }
  if (style.hAlign === "left" || style.hAlign === "center" || style.hAlign === "right") {
    css.textAlign = style.hAlign;
  } else if (style.hAlign === "justify") {
    css.textAlign = "justify";
  }
  if (style.vAlign === "top" || style.vAlign === "middle" || style.vAlign === "bottom") {
    css.verticalAlign = style.vAlign === "middle" ? "middle" : style.vAlign;
  }
  if (style.wrap) {
    css.whiteSpace = "pre-wrap";
    css.wordBreak = "break-word";
  }
  if (style.border) {
    css.borderTop = cssBorder(style.border.t);
    css.borderRight = cssBorder(style.border.r);
    css.borderBottom = cssBorder(style.border.b);
    css.borderLeft = cssBorder(style.border.l);
  }
  return css;
}

export function columnLetters(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
