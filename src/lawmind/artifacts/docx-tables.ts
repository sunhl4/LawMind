/**
 * 正式文书里的 Markdown 管道表格 → Word 表格。
 *
 * 只处理完整的「表头行 + 分隔行 + 数据行」；没有分隔行的竖线文本仍按正文渲染，
 * 避免把律师手写的 `|`（例如「甲方 | 乙方」）误判成表格。
 *
 * 版式：细黑网格、表头加粗并浅灰底、整行不跨页、表头跨页重复。
 */

import {
  AlignmentType,
  BorderStyle,
  LineRuleType,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { DocxFace } from "./docx-legal-typography.js";

export type MarkdownTableBlock = {
  kind: "table";
  header: string[];
  rows: string[][];
};

export type MarkdownTextBlock = { kind: "text"; text: string };

export type MarkdownBodyBlock = MarkdownTableBlock | MarkdownTextBlock;

const GRID = { style: BorderStyle.SINGLE, size: 4, color: "808080" } as const;
const TABLE_BORDERS = {
  top: GRID,
  bottom: GRID,
  left: GRID,
  right: GRID,
  insideHorizontal: GRID,
  insideVertical: GRID,
} as const;

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|", 1);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * 把正文拆成「文字块 / 表格块」，保持原有顺序。
 * 空行不单独成块；纯空白正文返回空数组。
 */
export function splitMarkdownTableBlocks(body: string): MarkdownBodyBlock[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBodyBlock[] = [];
  let textLines: string[] = [];
  const flushText = () => {
    const text = textLines.join("\n").trim();
    if (text) {
      blocks.push({ kind: "text", text });
    }
    textLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    if (isTableLine(line) && isTableLine(next) && isSeparatorRow(splitTableRow(next))) {
      flushText();
      const header = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableLine(lines[i] ?? "")) {
        rows.push(splitTableRow(lines[i] ?? ""));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    textLines.push(line);
  }
  flushText();
  return blocks;
}

/** 按每列最长文本分配百分比宽度；中文按字符数计。 */
function columnPercents(header: string[], rows: string[][]): number[] {
  const cols = Math.max(header.length, ...rows.map((row) => row.length), 1);
  const weights = Array.from({ length: cols }, (_, col) => {
    const lengths = [header[col] ?? "", ...rows.map((row) => row[col] ?? "")].map(
      (cell) => cell.trim().length,
    );
    return Math.min(40, Math.max(6, Math.max(...lengths, 6)));
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => Math.round((weight / total) * 1000) / 10);
}

function cellParagraph(text: string, face: DocxFace, header: boolean): Paragraph {
  return new Paragraph({
    alignment: header ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: {
      before: 40,
      after: 40,
      line: 300,
      lineRule: LineRuleType.AT_LEAST,
    },
    children: [
      new TextRun({
        text,
        bold: header,
        size: face.bodySize,
        font: {
          ascii: face.bodyLatin,
          hAnsi: face.bodyLatin,
          cs: face.bodyLatin,
          eastAsia: face.bodyEastAsia,
        },
      }),
    ],
  });
}

export function markdownTableToDocxTable(
  header: string[],
  rows: string[][],
  face: DocxFace,
): Table {
  const cols = Math.max(header.length, ...rows.map((row) => row.length), 1);
  const percents = columnPercents(header, rows);
  const row = (cells: string[], isHeader: boolean): TableRow =>
    new TableRow({
      tableHeader: isHeader,
      cantSplit: true,
      children: Array.from({ length: cols }, (_, col) => {
        const percent = percents[col] ?? Math.round(1000 / cols) / 10;
        return new TableCell({
          width: { size: percent, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          ...(isHeader
            ? {
                shading: { fill: "F2F2F2", type: ShadingType.CLEAR, color: "auto" },
              }
            : {}),
          children: [cellParagraph(cells[col] ?? "", face, isHeader)],
        });
      }),
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [row(header, true), ...rows.map((cells) => row(cells, false))],
  });
}
