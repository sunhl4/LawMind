/**
 * LawMind 默认 Word 交付物版式（法律与合同类文书常见纸质排版习惯，便于本所统一）
 *
 * 设计参考（行业通用做法，非某一条强制国标）：
 * - 正文字体：中文宋体（SimSun）12pt（小四），黑色；西文可配合 Times New Roman
 * - 标题：黑体（SimHei）区分层级，主标题居中偏大，章节标题加粗
 * - 版心：A4 默认，页边距约 1 英寸 / 2.54cm
 * - 行距：约 1.5 倍行距，段间适度留白
 * - 正文段落：首行左缩进约 2 个汉字宽（常见的「首行缩进两格」）
 *
 * 与英文资料中「12pt、serif/sans 可读性、1 英寸边距、用样式区隔标题与正文」等结论一致
 *（如法律写作与合同模板类指南中的排印讨论）。
 */

import { AlignmentType, convertInchesToTwip, LineRuleType, Paragraph, TextRun } from "docx";

/** 中文正文、表格 */
export const LEGAL_BODY_FONT = "SimSun";
/** 中文标题 */
export const LEGAL_HEADING_FONT = "SimHei";
/** 与宋体混排的西文/数字（常见搭配） */
export const LEGAL_LATIN_FONT = "Times New Roman";

/** docx 字号为 half-points：12pt=24，14pt=28，16pt=32，22pt=44 */
export const SZ_BODY = 24;
export const SZ_H1 = 32;
export const SZ_H2 = 28;
export const SZ_TITLE = 44;
export const SZ_SMALL = 21;

export const COLOR_TEXT = "000000";
export const COLOR_CITATION = "404040";

/** 正文首行缩进约 2 个汉字（12pt 量级下约 480 twips） */
const FIRST_LINE_INDENT_TWIPS = 480;

const LINE_15 = 360;

const PAGE_MARGIN_TWIPS = convertInchesToTwip(1);

export function defaultSectionPageProps(): {
  page: { margin: { top: number; right: number; bottom: number; left: number } };
} {
  return {
    page: {
      margin: {
        top: PAGE_MARGIN_TWIPS,
        right: PAGE_MARGIN_TWIPS,
        bottom: PAGE_MARGIN_TWIPS,
        left: PAGE_MARGIN_TWIPS,
      },
    },
  };
}

function bodyRun(
  text: string,
  opts: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {},
): TextRun {
  return new TextRun({
    text,
    font: LEGAL_BODY_FONT,
    size: opts.size ?? SZ_BODY,
    color: opts.color ?? COLOR_TEXT,
    bold: opts.bold,
    italics: opts.italics,
  });
}

/** 主标题：居中、黑体、二号左右 */
export function paragraphDocumentTitle(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: {
      before: convertInchesToTwip(0.08),
      after: convertInchesToTwip(0.18),
      line: LINE_15,
      lineRule: LineRuleType.AUTO,
    },
    children: [
      new TextRun({
        text,
        font: LEGAL_HEADING_FONT,
        size: SZ_TITLE,
        bold: true,
        color: COLOR_TEXT,
      }),
    ],
  });
}

/** 文种 / 元信息，小号居中 */
export function paragraphMetaCenter(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: convertInchesToTwip(0.06), line: 276, lineRule: LineRuleType.AUTO },
    children: [bodyRun(text, { size: SZ_SMALL })],
  });
}

export function paragraphHeading1(text: string): Paragraph {
  return new Paragraph({
    spacing: {
      before: convertInchesToTwip(0.12),
      after: convertInchesToTwip(0.06),
      line: LINE_15,
      lineRule: LineRuleType.AUTO,
    },
    children: [
      new TextRun({
        text,
        font: LEGAL_HEADING_FONT,
        size: SZ_H1,
        bold: true,
        color: COLOR_TEXT,
      }),
    ],
  });
}

export function paragraphHeading2(text: string): Paragraph {
  return new Paragraph({
    spacing: {
      before: convertInchesToTwip(0.1),
      after: convertInchesToTwip(0.05),
      line: LINE_15,
      lineRule: LineRuleType.AUTO,
    },
    children: [
      new TextRun({
        text,
        font: LEGAL_HEADING_FONT,
        size: SZ_H2,
        bold: true,
        color: COLOR_TEXT,
      }),
    ],
  });
}

/** 首行缩进两格、两端对齐的正文段 */
export function paragraphBodyFirstIndent(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: LINE_15, lineRule: LineRuleType.AUTO },
    indent: { firstLine: FIRST_LINE_INDENT_TWIPS },
    children: [bodyRun(text)],
  });
}

/**
 * 列表/条款行：悬挂缩进，不另做 Word 自动编号，避免与正文章节编号冲突
 */
function paragraphBodyListItem(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 100, line: LINE_15, lineRule: LineRuleType.AUTO },
    indent: {
      left: convertInchesToTwip(0.32),
      hanging: convertInchesToTwip(0.22),
    },
    children: [bodyRun(text)],
  });
}

function isListOrClauseLine(line: string): boolean {
  const t = line.trim();
  if (t.startsWith("- ") || t.startsWith("• ") || t.startsWith("* ")) {
    return true;
  }
  if (/^\d+[\s.)．、]/.test(t)) {
    return true;
  }
  if (
    /^[（(][一二三四五六七八九十\d]+[）)]\s+/.test(t) ||
    /^[一二三四五六七八九十]+[、.]\s*/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * 将章节正文按行拆成段落；无缩进的列表行用悬挂，其余用首行缩进
 */
export function bodyLinesToParagraphs(body: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    if (isListOrClauseLine(line)) {
      out.push(paragraphBodyListItem(line));
    } else {
      out.push(paragraphBodyFirstIndent(line));
    }
  }
  return out;
}

export function paragraphCitationBlock(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 60, after: 120, line: LINE_15, lineRule: LineRuleType.AUTO },
    indent: { firstLine: FIRST_LINE_INDENT_TWIPS },
    children: [
      new TextRun({
        text,
        font: LEGAL_BODY_FONT,
        size: 21,
        italics: true,
        color: COLOR_CITATION,
      }),
    ],
  });
}

export function deliverableTypeHint(deliverableType: string | undefined): string {
  if (!deliverableType) {
    return "法律文书 / 工作稿";
  }
  if (deliverableType.startsWith("contract.")) {
    return "合同类交付物 / 工作稿";
  }
  if (deliverableType.startsWith("letter.")) {
    return "律师函/函件类 / 工作稿";
  }
  return `${deliverableType} / 工作稿`;
}

export function formatDraftMetaLine(createdAt: string, matterId: string | undefined): string {
  const date = createdAt.slice(0, 10);
  return `成稿日期：${date}  ·  案件：${matterId?.trim() ? matterId : "无"}`;
}

/** 审阅备注行：与正文同字号，斜体区分 */
export function paragraphReviewNoteItem(note: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: LINE_15, lineRule: LineRuleType.AUTO },
    indent: { firstLine: FIRST_LINE_INDENT_TWIPS },
    children: [
      new TextRun({
        text: `• ${note}`,
        font: LEGAL_BODY_FONT,
        size: SZ_BODY,
        italics: true,
        color: COLOR_TEXT,
      }),
    ],
  });
}
