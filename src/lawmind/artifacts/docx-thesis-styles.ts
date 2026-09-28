/**
 * 调研报告采用的学位论文样式。
 * 数值来自正文样本的 Heading 1/2/4、标题3(2)、正文2、toc 1/2/3、TOC 标题1。
 * docx 库写不出 beforeLines / firstLineChars，打包后补进 styles.xml。
 */

import {
  AlignmentType,
  LeaderType,
  LineRuleType,
  TabStopType,
  type IParagraphStyleOptions,
  type IStylesOptions,
} from "docx";
import JSZip from "jszip";
import {
  COLOR_TEXT,
  LEGAL_BODY_FONT,
  REPORT_LATIN_FONT,
  THESIS_STYLE_BODY,
  THESIS_STYLE_H1,
  THESIS_STYLE_H2,
  THESIS_STYLE_H3,
  THESIS_STYLE_CAPTION,
  THESIS_STYLE_TITLE,
  THESIS_STYLE_TOC_TITLE,
} from "./docx-legal-typography.js";

const TOC_TAB = 8296;

function latinSong() {
  return {
    ascii: REPORT_LATIN_FONT,
    hAnsi: REPORT_LATIN_FONT,
    cs: REPORT_LATIN_FONT,
    eastAsia: LEGAL_BODY_FONT,
  };
}

export function reportDocumentStyles(): IStylesOptions {
  const run = {
    font: latinSong(),
    color: COLOR_TEXT,
  };
  const paragraphStyles: IParagraphStyleOptions[] = [
    {
      id: THESIS_STYLE_TITLE,
      name: "heading 1",
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      paragraph: {
        keepNext: true,
        keepLines: true,
        spacing: { before: 100, after: 200, line: 480, lineRule: LineRuleType.AUTO },
        alignment: AlignmentType.CENTER,
        outlineLevel: 0,
      },
      run: { ...run, bold: true, size: 32, sizeComplexScript: 44, kern: 44 },
    },
    {
      id: THESIS_STYLE_H1,
      name: "heading 2",
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      paragraph: {
        spacing: { before: 100, after: 100, line: 360, lineRule: LineRuleType.AUTO },
        alignment: AlignmentType.LEFT,
        outlineLevel: 1,
      },
      run: { ...run, bold: true, size: 28, sizeComplexScript: 32 },
    },
    {
      id: THESIS_STYLE_H2,
      name: "heading 3",
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      paragraph: {
        keepNext: true,
        keepLines: true,
        spacing: { before: 260, after: 260, line: 416, lineRule: LineRuleType.AUTO },
        alignment: AlignmentType.LEFT,
        outlineLevel: 2,
      },
      run: { ...run, bold: true, size: 24, sizeComplexScript: 24 },
    },
    {
      id: THESIS_STYLE_H3,
      name: "heading 4",
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      paragraph: {
        spacing: { before: 100, after: 100, line: 360, lineRule: LineRuleType.AUTO },
        alignment: AlignmentType.LEFT,
        outlineLevel: 3,
      },
      run: { ...run, bold: true, size: 24, sizeComplexScript: 28 },
    },
    {
      id: THESIS_STYLE_BODY,
      name: "正文2",
      basedOn: "Normal",
      next: THESIS_STYLE_BODY,
      quickFormat: true,
      paragraph: {
        spacing: { before: 50, after: 50, line: 360, lineRule: LineRuleType.AUTO },
        alignment: AlignmentType.BOTH,
        indent: { firstLine: 200 },
      },
      run: { ...run, size: 24 },
    },
    {
      id: THESIS_STYLE_CAPTION,
      name: "图表题注",
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      paragraph: {
        spacing: { before: 60, after: 100, line: 240, lineRule: LineRuleType.AUTO },
        alignment: AlignmentType.CENTER,
        indent: { firstLine: 0 },
      },
      run: { ...run, bold: false, size: 21, sizeComplexScript: 21 },
    },
    {
      id: THESIS_STYLE_TOC_TITLE,
      name: "TOC 标题1",
      basedOn: THESIS_STYLE_TITLE,
      next: "Normal",
      quickFormat: true,
      paragraph: {
        spacing: { before: 240, after: 0, line: 259, lineRule: LineRuleType.AUTO },
        alignment: AlignmentType.LEFT,
        outlineLevel: 9,
      },
      run: { ...run, bold: false, size: 32, sizeComplexScript: 32 },
    },
    {
      id: "TOC1",
      name: "toc 1",
      basedOn: "Normal",
      quickFormat: true,
      paragraph: {
        spacing: { line: 360, lineRule: LineRuleType.AUTO },
        tabStops: [{ type: TabStopType.RIGHT, position: TOC_TAB, leader: LeaderType.DOT }],
      },
      run: { ...run, bold: true, size: 28, sizeComplexScript: 28 },
    },
    {
      id: "TOC2",
      name: "toc 2",
      basedOn: "Normal",
      quickFormat: true,
      paragraph: {
        indent: { left: 420 },
        tabStops: [{ type: TabStopType.RIGHT, position: TOC_TAB, leader: LeaderType.DOT }],
      },
      run: { ...run, size: 24 },
    },
    {
      id: "TOC3",
      name: "toc 3",
      basedOn: "Normal",
      quickFormat: true,
      paragraph: {
        indent: { left: 840 },
      },
      run: { ...run, bold: true, size: 24 },
    },
  ];
  return {
    default: {
      document: {
        paragraph: { alignment: AlignmentType.BOTH },
        run: { font: latinSong(), size: 24 },
      },
    },
    paragraphStyles,
  };
}

const STYLE_SPACING: Record<string, string> = {
  [THESIS_STYLE_TITLE]:
    'w:before="100" w:beforeLines="100" w:after="200" w:afterLines="200" w:line="480" w:lineRule="auto"',
  [THESIS_STYLE_H1]:
    'w:before="100" w:beforeLines="100" w:after="100" w:afterLines="100" w:line="360" w:lineRule="auto"',
  [THESIS_STYLE_H3]:
    'w:before="100" w:beforeLines="100" w:after="100" w:afterLines="100" w:line="360" w:lineRule="auto"',
  [THESIS_STYLE_BODY]:
    'w:before="50" w:beforeLines="50" w:after="50" w:afterLines="50" w:line="360" w:lineRule="auto"',
  [THESIS_STYLE_CAPTION]:
    'w:before="60" w:after="100" w:afterLines="100" w:line="240" w:lineRule="auto"',
};

const STYLE_INDENT: Record<string, string> = {
  [THESIS_STYLE_BODY]: 'w:firstLine="200" w:firstLineChars="200"',
  [THESIS_STYLE_CAPTION]: 'w:firstLine="0" w:firstLineChars="0"',
  TOC2: 'w:left="420" w:leftChars="200"',
  TOC3: 'w:left="840" w:leftChars="400"',
};

function replaceInsideStyle(xml: string, styleId: string, edit: (block: string) => string): string {
  const marker = `w:styleId="${styleId}"`;
  const start = xml.indexOf(marker);
  if (start < 0) {
    return xml;
  }
  const end = xml.indexOf("</w:style>", start);
  if (end < 0) {
    return xml;
  }
  const block = xml.slice(start, end);
  return xml.slice(0, start) + edit(block) + xml.slice(end);
}

function patchStyleSpacing(xml: string, styleId: string, attrs: string): string {
  return replaceInsideStyle(xml, styleId, (block) =>
    block.replace(/<w:spacing\b[^>]*\/>/, `<w:spacing ${attrs}/>`),
  );
}

function patchStyleIndent(xml: string, styleId: string, attrs: string): string {
  return replaceInsideStyle(xml, styleId, (block) => {
    if (/<w:ind\b/.test(block)) {
      return block.replace(/<w:ind\b[^>]*\/>/, `<w:ind ${attrs}/>`);
    }
    return block.replace("</w:pPr>", `<w:ind ${attrs}/></w:pPr>`);
  });
}

/** 把学位论文的行单位段距、字符缩进写进样式。 */
export async function patchReportThesisDocx(input: Uint8Array): Promise<Buffer> {
  const zip = await JSZip.loadAsync(input);
  const stylesFile = zip.file("word/styles.xml");
  if (!stylesFile) {
    return Buffer.from(input);
  }
  let xml = await stylesFile.async("string");
  for (const [styleId, attrs] of Object.entries(STYLE_SPACING)) {
    xml = patchStyleSpacing(xml, styleId, attrs);
  }
  for (const [styleId, attrs] of Object.entries(STYLE_INDENT)) {
    xml = patchStyleIndent(xml, styleId, attrs);
  }
  zip.file("word/styles.xml", xml);
  const documentFile = zip.file("word/document.xml");
  if (documentFile) {
    const documentXml = await documentFile.async("string");
    // 库给目录缓存条目的点线制表位按 Letter 宽度（9025）。A4 版心右缘与学位论文一致，用 8296。
    zip.file("word/document.xml", documentXml.replace(/w:pos="9025"/g, 'w:pos="8296"'));
  }
  return zip.generateAsync({ type: "nodebuffer" });
}
