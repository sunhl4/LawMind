/**
 * LawMind Word 版式。
 *
 * 字体与颜色（产品约定）：全文黑色 #000000。备忘录与合同标题、正文一律宋体。
 *
 * 法律研究备忘录对齐律所备忘录：
 * https://github.com/zeweihan/A-market-ecm-lawyer-plugin/blob/main/shared/templates/legal-memo-format.md
 * - 文首：致 / 自 / 日期 / 事由 / 保密
 * - 主标题：16pt 加粗居中
 * - 一级「一、」/ 二级「（一）」/ 三级「1、」与正文同为 12pt，仅靠加粗 + 中文编号分层
 * - 两端对齐；首行缩进 2 字符；段后 18 磅；行距最小值 16 磅；A4 四边 2.5cm
 *
 * 调研报告 / 研究报告用学位论文正文版式（封面、声明、摘要、校名页眉已去掉，目录保留）：
 * - 中文宋体，西文与数字 Times New Roman，全文黑色
 * - 章标题 16pt 加粗居中，段前 1 行、段后 2 行，行距 2 倍
 * - 「一、」14pt 加粗左对齐，段前段后各 1 行，行距 1.5 倍
 * - 「（一）」12pt 加粗左对齐，段前段后 13 磅，行距 416
 * - 「1、」12pt 加粗左对齐，段前段后各 1 行，行距 1.5 倍
 * - 正文小四，段前段后各 0.5 行，行距 1.5 倍，首行缩进 2 字符
 * - 目录：标题不进目录；条目 1–3 级，点线制表符，`TOC \o "1-3" \h \u`
 * - A4；上下 2.54cm，左右 3.17cm；行网格 312；页脚居中页码，无校名
 *
 * 合同审查 / 律师函：宋体黑色；字号层级用 `FORMAL_FACE`。
 */

import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  convertInchesToTwip,
  convertMillimetersToTwip,
  ExternalHyperlink,
  Footer,
  LineRuleType,
  PageNumber,
  Paragraph,
  TextRun,
  type ICommentOptions,
  type IFontAttributesProperties,
} from "docx";
import type { SeeAlsoPart } from "../sources/citation-display.js";

/** 正文与标题统一宋体。 */
export const LEGAL_BODY_FONT = "SimSun";
/** 与正文同一字体，不再用黑体。 */
export const LEGAL_HEADING_FONT = "SimSun";
/** 备忘录西文与中文同用宋体。报告正文西文用 Times New Roman。 */
export const LEGAL_LATIN_FONT = "SimSun";
export const REPORT_LATIN_FONT = "Times New Roman";

/** docx 字号为 half-points：12pt=24，14pt=28，16pt=32，22pt=44 */
export const SZ_BODY = 24;
export const SZ_H1 = 32;
export const SZ_H2 = 28;
export const SZ_TITLE = 44;
export const SZ_SMALL = 21;

export const COLOR_TEXT = "000000";
/** 引用行也用黑色，不用灰色。 */
export const COLOR_CITATION = "000000";

/** 12pt 下约两个汉字。 */
const FIRST_LINE_INDENT_TWIPS = 480;
const LINE_15 = 360;
const PT = 20;

export type ChineseHeadingLevel = 1 | 2 | 3;

export type DocxFace = {
  id: "researchMemo" | "formal" | "researchReport";
  bodyEastAsia: string;
  bodyLatin: string;
  headingEastAsia: string;
  headingLatin: string;
  titleSize: number;
  h1Size: number;
  h2Size: number;
  h3Size: number;
  bodySize: number;
  smallSize: number;
  /** 备忘录：标题与正文同字号，首行缩进，不靠放大字号分层。 */
  headingSameAsBody: boolean;
  /** 正文行里的「一、／（一）／1、」升为标题。未设时与 headingSameAsBody 相同。 */
  promoteInlineHeadings?: boolean;
  line: number;
  lineRule: (typeof LineRuleType)[keyof typeof LineRuleType];
  bodySpaceBefore?: number;
  bodySpaceAfter: number;
  /** 主标题行距。未设时与正文行距相同。 */
  titleLine?: number;
  h1SpaceBefore: number;
  h1SpaceAfter: number;
  h2SpaceBefore: number;
  h2SpaceAfter: number;
  h3SpaceBefore: number;
  h3SpaceAfter: number;
  titleSpaceBefore: number;
  titleSpaceAfter: number;
  firstLineTwips: number;
  marginTwip: number;
  marginTopTwip?: number;
  marginBottomTwip?: number;
  marginLeftTwip?: number;
  marginRightTwip?: number;
  headerTwip?: number;
  footerTwip?: number;
  /** 页脚居中页码。报告用；不写校名或文首套话。 */
  showPageNumber?: boolean;
};

/** 法律研究备忘录。 */
export const RESEARCH_MEMO_FACE: DocxFace = {
  id: "researchMemo",
  bodyEastAsia: LEGAL_BODY_FONT,
  bodyLatin: LEGAL_LATIN_FONT,
  headingEastAsia: LEGAL_HEADING_FONT,
  headingLatin: LEGAL_LATIN_FONT,
  titleSize: 32,
  h1Size: SZ_BODY,
  h2Size: SZ_BODY,
  h3Size: SZ_BODY,
  bodySize: SZ_BODY,
  smallSize: 20,
  headingSameAsBody: true,
  line: 16 * PT,
  lineRule: LineRuleType.AT_LEAST,
  bodySpaceAfter: 18 * PT,
  h1SpaceBefore: 0,
  h1SpaceAfter: 18 * PT,
  h2SpaceBefore: 0,
  h2SpaceAfter: 18 * PT,
  h3SpaceBefore: 0,
  h3SpaceAfter: 18 * PT,
  titleSpaceBefore: 24 * PT,
  titleSpaceAfter: 24 * PT,
  firstLineTwips: FIRST_LINE_INDENT_TWIPS,
  marginTwip: convertMillimetersToTwip(25),
};

/** 合同审查、律师函：同样宋体黑色，字号层级不同。 */
export const FORMAL_FACE: DocxFace = {
  id: "formal",
  bodyEastAsia: LEGAL_BODY_FONT,
  bodyLatin: LEGAL_LATIN_FONT,
  headingEastAsia: LEGAL_HEADING_FONT,
  headingLatin: LEGAL_LATIN_FONT,
  titleSize: SZ_TITLE,
  h1Size: SZ_H1,
  h2Size: SZ_H2,
  h3Size: SZ_BODY,
  bodySize: SZ_BODY,
  smallSize: SZ_SMALL,
  headingSameAsBody: false,
  line: LINE_15,
  lineRule: LineRuleType.AUTO,
  bodySpaceAfter: 120,
  h1SpaceBefore: convertInchesToTwip(0.12),
  h1SpaceAfter: convertInchesToTwip(0.06),
  h2SpaceBefore: convertInchesToTwip(0.1),
  h2SpaceAfter: convertInchesToTwip(0.05),
  h3SpaceBefore: convertInchesToTwip(0.08),
  h3SpaceAfter: convertInchesToTwip(0.04),
  titleSpaceBefore: convertInchesToTwip(0.08),
  titleSpaceAfter: convertInchesToTwip(0.18),
  firstLineTwips: FIRST_LINE_INDENT_TWIPS,
  marginTwip: convertInchesToTwip(1),
};

/** 报告段落样式名。间距里的「行」由样式上的 beforeLines/afterLines 表达。 */
export const THESIS_STYLE_TITLE = "LMHeading1";
export const THESIS_STYLE_H1 = "LMHeading2";
export const THESIS_STYLE_H2 = "LMHeading3";
export const THESIS_STYLE_H3 = "LMHeading4";
export const THESIS_STYLE_BODY = "BodyText2";
export const THESIS_STYLE_TOC_TITLE = "TOCHeading";
export const THESIS_STYLE_CAPTION = "ThesisCaption";

/**
 * 调研报告 / 研究报告。
 * 字号与段落间距对齐学位论文 Heading 1/2、标题3(2)、Heading 4、正文2。
 * 不含封面、英文封面、摘要和「南京大学」页眉。目录样式保留。
 */
export const REPORT_FACE: DocxFace = {
  id: "researchReport",
  bodyEastAsia: LEGAL_BODY_FONT,
  bodyLatin: REPORT_LATIN_FONT,
  headingEastAsia: LEGAL_HEADING_FONT,
  headingLatin: REPORT_LATIN_FONT,
  titleSize: SZ_H1,
  h1Size: SZ_H2,
  h2Size: SZ_BODY,
  h3Size: SZ_BODY,
  bodySize: SZ_BODY,
  smallSize: SZ_SMALL,
  headingSameAsBody: false,
  promoteInlineHeadings: true,
  line: LINE_15,
  lineRule: LineRuleType.AUTO,
  titleLine: 480,
  bodySpaceBefore: 50,
  bodySpaceAfter: 50,
  h1SpaceBefore: 100,
  h1SpaceAfter: 100,
  h2SpaceBefore: 260,
  h2SpaceAfter: 260,
  h3SpaceBefore: 100,
  h3SpaceAfter: 100,
  titleSpaceBefore: 100,
  titleSpaceAfter: 200,
  firstLineTwips: 200,
  marginTwip: 1440,
  marginTopTwip: 1440,
  marginBottomTwip: 1440,
  marginLeftTwip: 1800,
  marginRightTwip: 1800,
  headerTwip: 851,
  footerTwip: 992,
  showPageNumber: true,
};

/**
 * 按律所备忘录中文编号识别标题层级。
 * 一级：一、  二级：（一）  三级：1、
 * 无法识别时返回 null（按正文处理）。
 */
export function classifyChineseHeadingLevel(text: string): ChineseHeadingLevel | null {
  const t = text.trim();
  if (!t) {
    return null;
  }
  if (t === "免责声明") {
    return 1;
  }
  if (/^[一二三四五六七八九十百]+、/.test(t)) {
    return 1;
  }
  if (/^[（(][一二三四五六七八九十\d]+[）)]/.test(t)) {
    return 2;
  }
  // 三级只用中文顿号「1、」，不用「0. / 1. / 2.1」这类西式或 AI 底稿编号
  if (/^\d+、/.test(t)) {
    return 3;
  }
  return null;
}

export function docxFaceForVariant(variant: string | undefined): DocxFace {
  if (variant === "contractReview" || variant === "demandLetter") {
    return FORMAL_FACE;
  }
  if (variant === "researchReport") {
    return REPORT_FACE;
  }
  return RESEARCH_MEMO_FACE;
}

function fontAttrs(eastAsia: string, latin: string): IFontAttributesProperties {
  return {
    ascii: latin,
    hAnsi: latin,
    cs: latin,
    eastAsia,
    hint: "eastAsia",
  };
}

export function defaultSectionPageProps(face: DocxFace = RESEARCH_MEMO_FACE): {
  page: {
    size: { width: number; height: number };
    margin: { top: number; right: number; bottom: number; left: number };
  };
} {
  return {
    page: {
      size: {
        width: convertMillimetersToTwip(210),
        height: convertMillimetersToTwip(297),
      },
      margin: {
        top: face.marginTopTwip ?? face.marginTwip,
        right: face.marginRightTwip ?? face.marginTwip,
        bottom: face.marginBottomTwip ?? face.marginTwip,
        left: face.marginLeftTwip ?? face.marginTwip,
        ...(face.headerTwip !== undefined ? { header: face.headerTwip } : {}),
        ...(face.footerTwip !== undefined ? { footer: face.footerTwip } : {}),
      },
    },
  };
}

function thesisHeadingStyle(level: ChineseHeadingLevel): string {
  if (level === 3) {
    return THESIS_STYLE_H3;
  }
  if (level === 2) {
    return THESIS_STYLE_H2;
  }
  return THESIS_STYLE_H1;
}

function bodyRun(
  text: string,
  face: DocxFace,
  opts: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {},
): TextRun {
  return new TextRun({
    text,
    font: fontAttrs(face.bodyEastAsia, face.bodyLatin),
    size: opts.size ?? face.bodySize,
    color: opts.color ?? COLOR_TEXT,
    bold: opts.bold,
    italics: opts.italics,
  });
}

function headingRun(text: string, face: DocxFace, size: number): TextRun {
  return new TextRun({
    text,
    font: fontAttrs(face.headingEastAsia, face.headingLatin),
    size,
    bold: true,
    color: COLOR_TEXT,
  });
}

/** 学位论文标题的中西文复杂脚本字号与正文字号可以不同。 */
function thesisHeadingRun(
  text: string,
  face: DocxFace,
  size: number,
  sizeComplexScript: number,
  bold = true,
): TextRun {
  return new TextRun({
    text,
    font: fontAttrs(face.headingEastAsia, face.headingLatin),
    size,
    sizeComplexScript,
    bold,
    color: COLOR_TEXT,
  });
}

/** 页脚居中页码。不写校名。 */
export function pageNumberFooter(face: DocxFace = REPORT_FACE): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            children: [PageNumber.CURRENT],
            font: fontAttrs(face.bodyEastAsia, face.bodyLatin),
            size: face.smallSize,
            color: COLOR_TEXT,
          }),
        ],
      }),
    ],
  });
}

/** 目录标题。大纲级别 9，不进入目录。 */
export function paragraphTocTitle(text = "目录", face: DocxFace = REPORT_FACE): Paragraph {
  return new Paragraph({
    style: THESIS_STYLE_TOC_TITLE,
    children: [thesisHeadingRun(text, face, face.titleSize, 32, false)],
  });
}

/** 主标题：备忘录为三号宋体居中；报告按学位论文章标题（16pt、2 倍行距、段前 1 行段后 2 行）。 */
export function paragraphDocumentTitle(
  text: string,
  face: DocxFace = RESEARCH_MEMO_FACE,
): Paragraph {
  if (face.id === "researchReport") {
    return new Paragraph({
      style: THESIS_STYLE_TITLE,
      children: [thesisHeadingRun(text, face, face.titleSize, 44)],
    });
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: {
      before: face.titleSpaceBefore,
      after: face.titleSpaceAfter,
      line: face.titleLine ?? face.line,
      lineRule: face.lineRule,
    },
    children: [
      new TextRun({
        text,
        font: fontAttrs(face.headingEastAsia, face.headingLatin),
        size: face.titleSize,
        bold: true,
        color: COLOR_TEXT,
      }),
    ],
  });
}

/** 文种 / 元信息，小号居中（合同、函件）。 */
export function paragraphMetaCenter(text: string, face: DocxFace = RESEARCH_MEMO_FACE): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: convertInchesToTwip(0.06), line: 276, lineRule: LineRuleType.AUTO },
    children: [bodyRun(text, face, { size: face.smallSize })],
  });
}

/** 备忘录文首字段行：左对齐、不缩进。 */
export function paragraphMemoField(text: string, face: DocxFace = RESEARCH_MEMO_FACE): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 0, line: face.line, lineRule: face.lineRule },
    children: [bodyRun(text, face)],
  });
}

/** 备忘录落款：右对齐。出处同一排版规范的落款三行。 */
export function paragraphMemoClosing(text: string, face: DocxFace = RESEARCH_MEMO_FACE): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { before: 0, after: 0, line: face.line, lineRule: face.lineRule },
    children: [bodyRun(text, face)],
  });
}

export function paragraphHeading1(text: string, face: DocxFace = RESEARCH_MEMO_FACE): Paragraph {
  if (face.id === "researchReport") {
    return new Paragraph({
      style: THESIS_STYLE_H1,
      children: [thesisHeadingRun(text, face, face.h1Size, 32)],
    });
  }
  return new Paragraph({
    spacing: {
      before: face.h1SpaceBefore,
      after: face.h1SpaceAfter,
      line: face.line,
      lineRule: face.lineRule,
    },
    indent: face.headingSameAsBody ? { firstLine: face.firstLineTwips } : undefined,
    children: [headingRun(text, face, face.h1Size)],
  });
}

export function paragraphHeading2(text: string, face: DocxFace = RESEARCH_MEMO_FACE): Paragraph {
  if (face.id === "researchReport") {
    return new Paragraph({
      style: THESIS_STYLE_H2,
      children: [thesisHeadingRun(text, face, face.h2Size, 24)],
    });
  }
  return new Paragraph({
    spacing: {
      before: face.h2SpaceBefore,
      after: face.h2SpaceAfter,
      line: face.line,
      lineRule: face.lineRule,
    },
    indent: face.headingSameAsBody ? { firstLine: face.firstLineTwips } : undefined,
    children: [headingRun(text, face, face.h2Size)],
  });
}

export function paragraphHeading3(text: string, face: DocxFace = RESEARCH_MEMO_FACE): Paragraph {
  if (face.id === "researchReport") {
    return new Paragraph({
      style: THESIS_STYLE_H3,
      children: [thesisHeadingRun(text, face, face.h3Size, 28)],
    });
  }
  return new Paragraph({
    spacing: {
      before: face.h3SpaceBefore,
      after: face.h3SpaceAfter,
      line: face.line,
      lineRule: face.lineRule,
    },
    indent: face.headingSameAsBody ? { firstLine: face.firstLineTwips } : undefined,
    children: [headingRun(text, face, face.h3Size)],
  });
}

/** 按中文编号层级出标题；无法识别时按一级。 */
export function paragraphHeadingAtLevel(
  text: string,
  face: DocxFace = RESEARCH_MEMO_FACE,
  level?: ChineseHeadingLevel | null,
): Paragraph {
  const resolved = level ?? classifyChineseHeadingLevel(text) ?? 1;
  if (resolved === 3) {
    return paragraphHeading3(text, face);
  }
  if (resolved === 2) {
    return paragraphHeading2(text, face);
  }
  return paragraphHeading1(text, face);
}

/**
 * Heading paragraph with a linked Word comment (provenance annotation).
 * Returns the paragraph plus the Comment object to register on the Document.
 */
export function paragraphHeading2WithComment(
  text: string,
  commentText: string,
  commentId: number,
  face: DocxFace = RESEARCH_MEMO_FACE,
): { paragraph: Paragraph; comment: ICommentOptions } {
  const level = classifyChineseHeadingLevel(text) ?? 2;
  const size = level === 1 ? face.h1Size : level === 3 ? face.h3Size : face.h2Size;
  const before =
    level === 1 ? face.h1SpaceBefore : level === 3 ? face.h3SpaceBefore : face.h2SpaceBefore;
  const after =
    level === 1 ? face.h1SpaceAfter : level === 3 ? face.h3SpaceAfter : face.h2SpaceAfter;
  const paragraph = new Paragraph({
    ...(face.id === "researchReport" ? { style: thesisHeadingStyle(level) } : {}),
    ...(face.id === "researchReport"
      ? {}
      : {
          spacing: {
            before,
            after,
            line: face.line,
            lineRule: face.lineRule,
          },
          indent: face.headingSameAsBody ? { firstLine: face.firstLineTwips } : undefined,
        }),
    children: [
      new CommentRangeStart(commentId),
      headingRun(text, face, size),
      new CommentRangeEnd(commentId),
      new CommentReference(commentId),
    ],
  });
  const comment: ICommentOptions = {
    id: commentId,
    author: "LawMind",
    date: new Date(),
    children: [
      new Paragraph({
        children: [bodyRun(commentText, face, { size: face.smallSize, color: COLOR_CITATION })],
      }),
    ],
  };
  return { paragraph, comment };
}

/** 首行缩进两格、两端对齐的正文段。 */
export function paragraphBodyFirstIndent(
  text: string,
  face: DocxFace = RESEARCH_MEMO_FACE,
): Paragraph {
  if (face.id === "researchReport") {
    return new Paragraph({
      style: THESIS_STYLE_BODY,
      children: [bodyRun(text, face)],
    });
  }
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: {
      before: face.bodySpaceBefore ?? 0,
      after: face.bodySpaceAfter,
      line: face.line,
      lineRule: face.lineRule,
    },
    indent: { firstLine: face.firstLineTwips },
    children: [bodyRun(text, face)],
  });
}

/**
 * 列表/条款行：悬挂缩进，不另做 Word 自动编号，避免与正文章节编号冲突。
 */
function paragraphBodyListItem(text: string, face: DocxFace): Paragraph {
  if (face.id === "researchReport") {
    return new Paragraph({
      style: THESIS_STYLE_BODY,
      indent: {
        left: convertInchesToTwip(0.32),
        hanging: convertInchesToTwip(0.22),
      },
      children: [bodyRun(text, face)],
    });
  }
  const after = face.headingSameAsBody ? 6 * PT : 100;
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after, line: face.line, lineRule: face.lineRule },
    indent: {
      left: convertInchesToTwip(0.32),
      hanging: convertInchesToTwip(0.22),
    },
    children: [bodyRun(text, face)],
  });
}

function isBulletListLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("- ") || t.startsWith("• ") || t.startsWith("* ");
}

/**
 * 将章节正文按行拆成段落。
 * 备忘录面：命中中文标题编号的行升为对应级标题；其余列表行用悬挂，正文用首行缩进。
 */
export function bodyLinesToParagraphs(
  body: string,
  face: DocxFace = RESEARCH_MEMO_FACE,
): Paragraph[] {
  const out: Paragraph[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    if (face.promoteInlineHeadings ?? face.headingSameAsBody) {
      const level = classifyChineseHeadingLevel(line);
      if (level) {
        out.push(paragraphHeadingAtLevel(line, face, level));
        continue;
      }
    }
    if (
      isBulletListLine(line) ||
      (!face.headingSameAsBody &&
        (/^\d+[\s.)．、]/.test(line) ||
          /^[（(][一二三四五六七八九十\d]+[）)]/.test(line) ||
          /^[一二三四五六七八九十]+[、.]/.test(line)))
    ) {
      out.push(paragraphBodyListItem(line, face));
    } else {
      out.push(paragraphBodyFirstIndent(line, face));
    }
  }
  return out;
}

export function paragraphCitationBlock(
  text: string,
  face: DocxFace = RESEARCH_MEMO_FACE,
): Paragraph {
  const citeRun = bodyRun(text, face, {
    size: face.smallSize,
    italics: face.id === "formal",
    color: COLOR_CITATION,
  });
  if (face.id === "researchReport") {
    return new Paragraph({
      style: THESIS_STYLE_BODY,
      children: [citeRun],
    });
  }
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 60, after: face.bodySpaceAfter, line: face.line, lineRule: face.lineRule },
    indent: face.headingSameAsBody
      ? { left: face.firstLineTwips, right: face.firstLineTwips }
      : { firstLine: face.firstLineTwips },
    children: [citeRun],
  });
}

/**
 * 「参见」行（带超链接）：有 url 的来源渲染为可点击链接（如 NPC FLK 详情页），
 * 无 url 的保持纯文本。
 */
export function paragraphCitationBlockWithLinks(
  parts: SeeAlsoPart[],
  face: DocxFace = RESEARCH_MEMO_FACE,
): Paragraph {
  const italics = face.id === "formal";
  const cite = (text: string) =>
    bodyRun(text, face, { size: face.smallSize, italics, color: COLOR_CITATION });
  const children: Array<TextRun | ExternalHyperlink> = [cite("参见：")];
  parts.forEach((part, index) => {
    const text = `${part.marker}${part.label}`;
    if (part.url) {
      children.push(
        new ExternalHyperlink({
          link: part.url,
          children: [
            new TextRun({
              text,
              font: fontAttrs(face.bodyEastAsia, face.bodyLatin),
              size: face.smallSize,
              italics,
              color: COLOR_CITATION,
              style: "Hyperlink",
            }),
          ],
        }),
      );
    } else {
      children.push(cite(text));
    }
    children.push(cite(index === parts.length - 1 ? "。" : "；"));
  });
  if (face.id === "researchReport") {
    return new Paragraph({
      style: THESIS_STYLE_BODY,
      children,
    });
  }
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 60, after: face.bodySpaceAfter, line: face.line, lineRule: face.lineRule },
    indent: face.headingSameAsBody
      ? { left: face.firstLineTwips, right: face.firstLineTwips }
      : { firstLine: face.firstLineTwips },
    children,
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

/** 审阅备注行：与正文同字号，斜体区分。 */
export function paragraphReviewNoteItem(
  note: string,
  face: DocxFace = RESEARCH_MEMO_FACE,
): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: face.bodySpaceAfter, line: face.line, lineRule: face.lineRule },
    indent: { firstLine: face.firstLineTwips },
    children: [bodyRun(`• ${note}`, face, { italics: true })],
  });
}
