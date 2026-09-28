/**
 * 调研报告里的图、表，按学位论文正文实测：
 * - 图宽约版心 14.66 cm，居中；题注在图下，样式「图表题注」（10.5 pt，单倍行距，段后 0.5 行）
 * - 表为三线表：顶线、表头下横线、底线均为 1.5 pt，无竖线；表心 9 pt；题注在表上
 * - 编号用「图 1-1」「表 1-1」
 */

import {
  AlignmentType,
  BorderStyle,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type FileChild,
} from "docx";
import { parseChartSpec, type ChartSpec } from "../agent/tools/legal/chart-spec.js";
import {
  THESIS_CHART_HEIGHT,
  THESIS_CHART_WIDTH,
  renderChartSvg,
} from "../agent/tools/legal/chart-svg.js";
import {
  LEGAL_BODY_FONT,
  REPORT_FACE,
  REPORT_LATIN_FONT,
  THESIS_STYLE_CAPTION,
  bodyLinesToParagraphs,
} from "./docx-legal-typography.js";

/** 版心宽：A4 11906 − 左右 1800×2。 */
const TEXT_WIDTH_DXA = 8306;
const FIGURE_WIDTH_PX = 554;
const FIGURE_HEIGHT_PX = Math.round((FIGURE_WIDTH_PX * THESIS_CHART_HEIGHT) / THESIS_CHART_WIDTH);

const LINE_NONE = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
const LINE_RULE = { style: BorderStyle.SINGLE, size: 12, color: "000000" } as const;

/** 1×1 白图。Word 显示 SVG；此图只作库要求的回退。 */
const PNG_FALLBACK = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export type ThesisFigureCounters = {
  figure: number;
  table: number;
};

function latinSong() {
  return {
    ascii: REPORT_LATIN_FONT,
    hAnsi: REPORT_LATIN_FONT,
    cs: REPORT_LATIN_FONT,
    eastAsia: LEGAL_BODY_FONT,
  };
}

function captionParagraph(text: string): Paragraph {
  return new Paragraph({
    style: THESIS_STYLE_CAPTION,
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text,
        font: latinSong(),
        size: 21,
        bold: false,
        color: "000000",
      }),
    ],
  });
}

function numberedCaption(
  kind: "图" | "表",
  pending: string | undefined,
  counters: ThesisFigureCounters,
): string {
  const explicit = pending?.trim() ?? "";
  const matched = explicit.match(/^(图|表)\s*(?:\d+\s*[-－]\s*)?(\d+)/);
  if (explicit.startsWith(kind) && matched) {
    const n = Number(matched[2]);
    if (kind === "图") {
      counters.figure = Math.max(counters.figure, n);
    } else {
      counters.table = Math.max(counters.table, n);
    }
    return explicit;
  }
  const n = kind === "图" ? ++counters.figure : ++counters.table;
  const title = explicit.replace(/^(图|表)\s*/, "").trim();
  return title ? `${kind} 1-${n} ${title}` : `${kind} 1-${n}`;
}

function isMarkdownTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.includes("|", 1);
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function thesisTable(rows: string[][]): Table {
  const cols = Math.max(...rows.map((row) => row.length), 1);
  const colWidth = Math.floor(TEXT_WIDTH_DXA / cols);
  return new Table({
    width: { size: TEXT_WIDTH_DXA, type: WidthType.DXA },
    alignment: AlignmentType.CENTER,
    borders: {
      top: LINE_RULE,
      bottom: LINE_RULE,
      left: LINE_NONE,
      right: LINE_NONE,
      insideHorizontal: LINE_NONE,
      insideVertical: LINE_NONE,
    },
    rows: rows.map((row, rowIndex) => {
      const header = rowIndex === 0;
      return new TableRow({
        children: Array.from({ length: cols }, (_, col) => {
          const text = row[col] ?? "";
          return new TableCell({
            width: { size: colWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            borders: {
              top: header ? LINE_RULE : LINE_NONE,
              bottom: header ? LINE_RULE : LINE_NONE,
              left: LINE_NONE,
              right: LINE_NONE,
            },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 40, after: 40, line: 240, lineRule: "auto" },
                children: [
                  new TextRun({
                    text,
                    font: latinSong(),
                    size: 18,
                    bold: header,
                    color: "000000",
                  }),
                ],
              }),
            ],
          });
        }),
      });
    }),
  });
}

function thesisChartFigure(spec: ChartSpec): Paragraph {
  const svg = renderChartSvg(spec);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 60, line: 240, lineRule: "auto" },
    children: [
      new ImageRun({
        type: "svg",
        data: Buffer.from(svg, "utf8"),
        fallback: { type: "png", data: PNG_FALLBACK },
        transformation: { width: FIGURE_WIDTH_PX, height: FIGURE_HEIGHT_PX },
        altText: { name: spec.title, title: spec.title, description: spec.title },
      }),
    ],
  });
}

function takeCaption(buffer: string[], kind: "图" | "表"): string | undefined {
  const last = buffer.at(-1)?.trim() ?? "";
  if (!last.startsWith(kind)) {
    return undefined;
  }
  buffer.pop();
  return last;
}

function chartFromFence(jsonText: string): ChartSpec | undefined {
  try {
    const parsed = parseChartSpec(JSON.parse(jsonText) as unknown);
    return parsed.ok ? parsed.spec : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 把报告正文里的 Markdown 表和 ```lm-chart 围栏收成学位论文图、表。
 * 其余行仍按报告正文样式排。
 */
export function reportBodyChildren(body: string, counters: ThesisFigureCounters): FileChild[] {
  const lines = body.split("\n");
  const out: FileChild[] = [];
  const prose: string[] = [];
  const flushProse = () => {
    const text = prose.join("\n").trim();
    prose.length = 0;
    if (text) {
      out.push(...bodyLinesToParagraphs(text, REPORT_FACE));
    }
  };

  let i = 0;
  while (i < lines.length) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed.startsWith("```lm-chart")) {
      const caption = takeCaption(prose, "图");
      flushProse();
      const jsonLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        jsonLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      const spec = chartFromFence(jsonLines.join("\n"));
      if (!spec) {
        prose.push(jsonLines.join("\n"));
        continue;
      }
      out.push(thesisChartFigure(spec));
      out.push(captionParagraph(numberedCaption("图", caption ?? spec.title, counters)));
      continue;
    }
    if (isMarkdownTableLine(trimmed)) {
      const caption = takeCaption(prose, "表");
      flushProse();
      const rawRows: string[][] = [];
      while (i < lines.length && isMarkdownTableLine((lines[i] ?? "").trim())) {
        rawRows.push(splitTableRow(lines[i] ?? ""));
        i += 1;
      }
      const rows = rawRows.filter((row) => !isSeparatorRow(row));
      if (rows.length === 0) {
        continue;
      }
      out.push(captionParagraph(numberedCaption("表", caption, counters)));
      out.push(thesisTable(rows));
      continue;
    }
    prose.push(lines[i] ?? "");
    i += 1;
  }
  flushProse();
  return out;
}
