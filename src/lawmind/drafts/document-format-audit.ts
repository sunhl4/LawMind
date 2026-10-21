/**
 * L1 格式体检：只读，不改文件。
 *
 * 三种口径，顺序不能混：
 * 1. `from-scratch` 从零起草 —— 按国标公文格式草案检查整篇。
 * 2. `imported` 外来件（当事人/客户/对方回稿）—— 以文件自身的主流格式为准，
 *    只检查 LawMind 新增/改写的段落是否跟原文一致；不套模板、不查页边距。
 * 3. `retemplate` 律师明确要求整体调整格式 —— 这时才按国标草案做整篇检查。
 *
 * 【待律师确认】国标规则目前只是草案基线，见 `GB_T_9704_NOTICE_ZH`。
 * 统一口径后替换本文件的规则表即可，检查与报告的形状不变。
 *
 * 原则：不检查的项目写进 `unchecked`，不假装通过。
 */

import type {
  WordAlign,
  WordLayoutBlock,
  WordLayoutParagraph,
  WordLineSpacing,
  WordPageBox,
} from "./word-surface-layout.js";

/** 醒目占位：给后续替代码用。 */
export const FORMAT_STANDARD_TODO_MARKER = "TODO(lawyer-format-standard)";

export const GB_T_9704_ID = "gb-t-9704-2012";

export const GB_T_9704_NOTICE_ZH =
  "【待律师确认】当前按《党政机关公文格式》GB/T 9704-2012 草案检查，只用于「从零起草」的文件；" +
  "诉讼文书另有法院样式，是否全国标统一、是否分法院/所内模板，待与律师访谈后确定。";

const PT_TO_PX = 96 / 72;
const MM_TO_PX = 96 / 25.4;

/** A4 与版心：GB/T 9704-2012 第 5 章、第 6 章。 */
const GB_PAGE = {
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 37,
  marginRightMm: 26,
  marginBottomMm: 35,
  marginLeftMm: 28,
  toleranceMm: 1,
} as const;

/** 正文：3 号仿宋，固定行距 28 磅，首行缩进 2 字。 */
const GB_BODY = {
  fontFamily: "仿宋",
  fontPt: 16,
  linePt: 28,
  /** 允许 26.5–30 磅：公文实际排版常见 28–28.8 磅。 */
  linePtMin: 26.5,
  linePtMax: 30,
  firstIndentChars: 2,
  /** 字号/字体容差。Word 字号按半磅递增，0.5pt 就是「小三 vs 三号」。 */
  sizePtTolerance: 0.25,
  indentCharsTolerance: 0.3,
} as const;

/** 标题：2 号小标宋，居中。 */
const GB_TITLE = { fontFamily: "小标宋", fontPt: 22 } as const;

const GB_HEADINGS = [
  { level: 1, pattern: /^[一二三四五六七八九十百]+、/, fontFamily: "黑体" },
  { level: 2, pattern: /^[（(][一二三四五六七八九十百\d]+[）)]/, fontFamily: "楷体" },
  { level: 3, pattern: /^\d+[.．、]/, fontFamily: "仿宋" },
] as const;

export type FormatAuditMode = "from-scratch" | "imported" | "retemplate";

export type FormatAuditSeverity = "error" | "warning" | "info";

export type FormatAuditFinding = {
  code: string;
  severity: FormatAuditSeverity;
  /** 给律师看的一句话。 */
  messageZh: string;
  /** 阅读序段落号（0 基），与 WordSurfaceSnapshot.paragraphs 对齐。 */
  paragraphIndex?: number;
  actual?: string;
  expected?: string;
  /** 判据来源：国标条款，或「原文主流格式」。 */
  basisZh: string;
};

export type DocumentFormatProfile = {
  /** 参与统计的正文段落数。 */
  sampleCount: number;
  /** 归一化后的字体名（仿宋/楷体/宋体/黑体/小标宋…）。 */
  fontFamily?: string;
  /** 文件里写出的原始字体串，便于核对。 */
  fontFamilyRaw?: string;
  /** 原文 run 的原始 `<w:rFonts …/>`，写回时优先用它，避免东亚字体名漂移。 */
  rFontsXml?: string;
  fontSizePx?: number;
  /** Word 的半磅字号，精确到 0.5pt（避免 px 取整把三号和小三混在一起）。 */
  fontSizePt?: number;
  line?: WordLineSpacing;
  firstIndentChars?: number;
  /** 按字数加权的「字体 + 字号」一致率，0–1。 */
  share: number;
  /** 例如「仿宋 三号（16pt）」。 */
  labelZh: string;
};

export type FormatAuditStandard = {
  id: typeof GB_T_9704_ID | "document-self";
  labelZh: string;
  /** 规则尚未与律师定稿。 */
  provisional: boolean;
  /** 律师明确要求整体套模板（只有这时才允许改整篇）。 */
  requestedByLawyer: boolean;
  noticeZh: string;
  todoMarker?: string;
};

export type FormatAuditCounts = {
  error: number;
  warning: number;
  info: number;
};

export type FormatAuditReport = {
  mode: FormatAuditMode;
  standard: FormatAuditStandard;
  profile: DocumentFormatProfile;
  findings: FormatAuditFinding[];
  /** 本轮确实没有检查的项目，不当作通过。 */
  unchecked: string[];
  /** 被报告上限截掉的条数（计数仍完整）。 */
  omittedFindings: number;
  counts: FormatAuditCounts;
  /** 无 error 即 `ok`；warning 不阻塞。 */
  ok: boolean;
  summaryZh: string;
};

export type FormatAuditInput = {
  page: WordPageBox;
  blocks: readonly WordLayoutBlock[];
  mode: FormatAuditMode;
  /**
   * 文档含文本框。框内是嵌套段落，提取器不解析，所以要在报告里明说「未检查」，
   * 不能让律师以为框里的字也核过了。
   */
  hasTextBoxes?: boolean;
  /**
   * 仅 `imported` 用：LawMind 这次新增/改写的段落（阅读序，0 基）。
   * 这些段落必须跟随文件自身的主流格式，而不是我们的模板。
   */
  lawmindParagraphs?: readonly number[];
};

const REPORT_LIMIT = 40;

/** CSS 字体栈 → 一个可比对的字体名。取第一个能认出来的字面。 */
export function canonicalFontFamily(fontFamily: string | undefined): string | undefined {
  if (!fontFamily?.trim()) {
    return undefined;
  }
  const faces = fontFamily
    .split(",")
    .map((face) => face.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  for (const face of faces) {
    const name = canonicalFontFace(face);
    if (name) {
      return name;
    }
  }
  return faces[0];
}

function canonicalFontFace(face: string): string | undefined {
  const value = face.toLowerCase().replace(/\s+/g, "");
  if (/小标宋|xiaobiaosong|fzxbs/.test(value)) {
    return "小标宋";
  }
  if (/仿宋|fangsong/.test(value)) {
    return "仿宋";
  }
  if (/楷体|kaiti/.test(value)) {
    return "楷体";
  }
  if (/黑体|simhei|heiti/.test(value)) {
    return "黑体";
  }
  if (/宋体|simsun|songti|stsong/.test(value)) {
    return "宋体";
  }
  if (/timesnewroman/.test(value)) {
    return "Times New Roman";
  }
  return undefined;
}

function pxToPt(px: number): number {
  return Math.round((px / PT_TO_PX) * 10) / 10;
}

/** 16pt → 三号；22pt → 二号。用于报告里的中文叫法。 */
export function chineseFontSizeLabel(pt: number | undefined): string | undefined {
  if (pt == null) {
    return undefined;
  }
  const table: Array<[number, string]> = [
    [26, "一号"],
    [24, "小一"],
    [22, "二号"],
    [18, "小二"],
    [16, "三号"],
    [15, "小三"],
    [14, "四号"],
    [12, "小四"],
    [10.5, "五号"],
    [9, "小五"],
  ];
  const hit = table.find(([size]) => Math.abs(size - pt) < 0.3);
  return hit?.[1];
}

function sizeLabel(px: number | undefined, pt?: number): string | undefined {
  const points = pt ?? (px != null ? pxToPt(px) : undefined);
  if (points == null) {
    return undefined;
  }
  const name = chineseFontSizeLabel(points);
  return `${name ? `${name}　` : ""}${points}pt`;
}

function fontLabel(
  family: string | undefined,
  px: number | undefined,
  pt?: number,
): string | undefined {
  const size = sizeLabel(px, pt);
  return [family, size].filter(Boolean).join("　") || undefined;
}

function lineLabel(line: WordLineSpacing | undefined): string | undefined {
  if (!line) {
    return undefined;
  }
  if (line.rule === "auto") {
    return line.multiple === 1 ? "单倍行距" : `${line.multiple} 倍行距`;
  }
  const pt = Math.round((line.px / PT_TO_PX) * 10) / 10;
  return `${line.rule === "exact" ? "固定值" : "最小值"} ${pt} 磅`;
}

function alignLabel(align: WordAlign | undefined): string {
  switch (align) {
    case "center":
      return "居中";
    case "right":
      return "右对齐";
    case "both":
      return "两端对齐";
    default:
      return "左对齐";
  }
}

type FlatParagraph = {
  paragraph: WordLayoutParagraph;
  index: number;
  inTable: boolean;
};

function flattenParagraphs(blocks: readonly WordLayoutBlock[]): FlatParagraph[] {
  const out: FlatParagraph[] = [];
  const visit = (list: readonly WordLayoutBlock[], inTable: boolean) => {
    for (const block of list) {
      if (block.kind === "paragraph") {
        out.push({ paragraph: block, index: out.length, inTable });
        continue;
      }
      for (const row of block.rows) {
        for (const cell of row) {
          visit(cell.blocks, true);
        }
      }
    }
  };
  visit(blocks, false);
  return out;
}

function visibleRuns(paragraph: WordLayoutParagraph) {
  return paragraph.runs.filter(
    (run) =>
      run.text.trim().length > 0 && run.track?.kind !== "del" && run.track?.kind !== "moveFrom",
  );
}

/** 段落里占比最大的那种写法。 */
function dominantRunMark(paragraph: WordLayoutParagraph) {
  const runs = visibleRuns(paragraph);
  let best: (typeof runs)[number] | undefined;
  for (const run of runs) {
    if (!best || run.text.length > best.text.length) {
      best = run;
    }
  }
  return {
    fontFamily: best?.fontFamily ?? paragraph.fontFamily,
    fontSizePx: best?.fontSizePx,
    fontSizePt: best?.fontSizePt,
    rFontsXml: best?.rFontsXml,
  };
}

/** 优先用半磅字号；老快照只有 px 时才换算。 */
function markSizePt(mark: { fontSizePt?: number; fontSizePx?: number }): number | undefined {
  if (mark.fontSizePt != null) {
    return mark.fontSizePt;
  }
  return mark.fontSizePx != null ? pxToPt(mark.fontSizePx) : undefined;
}

function headingLevel(paragraph: WordLayoutParagraph): number | undefined {
  const text = paragraph.text.trim();
  if (!text) {
    return undefined;
  }
  // 太长的段落不按「1.」当三级标题：合同里的 1./2. 多是正文条款，
  // 短句才更像标题。40 字上限与排版大纲一致。
  if (text.length <= 40) {
    for (const heading of GB_HEADINGS) {
      if (heading.pattern.test(text)) {
        return heading.level;
      }
    }
  }
  if (paragraph.outlineLevel != null && paragraph.outlineLevel >= 1) {
    return Math.min(paragraph.outlineLevel, 3);
  }
  return undefined;
}

function isRecipientLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 40 && trimmed.endsWith("：");
}

function isBodySample(flat: FlatParagraph): boolean {
  const { paragraph } = flat;
  const text = paragraph.text.trim();
  if (flat.inTable || text.length < 8) {
    return false;
  }
  if (paragraph.align === "center" || paragraph.align === "right") {
    return false;
  }
  if (headingLevel(paragraph) != null) {
    return false;
  }
  return true;
}

function firstIndentChars(
  paragraph: WordLayoutParagraph,
  fontSizePx: number | undefined,
): number | undefined {
  const indent = paragraph.firstIndent;
  if (!indent) {
    return 0;
  }
  if (indent.unit === "em") {
    return indent.value;
  }
  if (indent.unit === "px" && fontSizePx) {
    return indent.value / fontSizePx;
  }
  return undefined;
}

function weightedMode(values: Array<{ value: string; weight: number }>): string | undefined {
  const totals = new Map<string, number>();
  for (const { value, weight } of values) {
    totals.set(value, (totals.get(value) ?? 0) + weight);
  }
  let best: { value: string; weight: number } | undefined;
  for (const [value, weight] of totals) {
    if (!best || weight > best.weight) {
      best = { value, weight };
    }
  }
  return best?.value;
}

/** 从文件自身推「主流格式」：外来件跟随原文时用它当基准。 */
export function buildDocumentFormatProfile(
  blocks: readonly WordLayoutBlock[],
): DocumentFormatProfile {
  const samples = flattenParagraphs(blocks).filter(isBodySample);
  if (samples.length === 0) {
    return { sampleCount: 0, share: 0, labelZh: "无法识别正文主流格式" };
  }

  const familyValues: Array<{ value: string; weight: number }> = [];
  const sizePtValues: Array<{ value: string; weight: number }> = [];
  const sizePxValues: Array<{ value: string; weight: number }> = [];
  const lineValues: Array<{ value: string; weight: number }> = [];
  const indentValues: Array<{ value: string; weight: number }> = [];
  const rFontsValues: Array<{ value: string; weight: number }> = [];
  const rawFamily = new Map<string, number>();

  for (const flat of samples) {
    const mark = dominantRunMark(flat.paragraph);
    const weight = flat.paragraph.text.trim().length;
    const family = canonicalFontFamily(mark.fontFamily);
    if (family) {
      familyValues.push({ value: family, weight });
      const raw = mark.fontFamily ?? "";
      rawFamily.set(raw, (rawFamily.get(raw) ?? 0) + weight);
    }
    if (mark.rFontsXml) {
      rFontsValues.push({ value: mark.rFontsXml, weight });
    }
    const sizePt = markSizePt(mark);
    if (sizePt != null) {
      sizePtValues.push({ value: sizePt.toFixed(1), weight });
    }
    if (mark.fontSizePx != null) {
      sizePxValues.push({ value: mark.fontSizePx.toFixed(1), weight });
    }
    if (flat.paragraph.line) {
      lineValues.push({ value: JSON.stringify(flat.paragraph.line), weight });
    }
    const indent = firstIndentChars(flat.paragraph, mark.fontSizePx);
    if (indent != null) {
      indentValues.push({ value: indent.toFixed(2), weight });
    }
  }

  const family = weightedMode(familyValues);
  const sizePtKey = weightedMode(sizePtValues);
  const sizePxKey = weightedMode(sizePxValues);
  const fontSizePt = sizePtKey != null ? Number(sizePtKey) : undefined;
  const fontSizePx = sizePxKey != null ? Number(sizePxKey) : undefined;
  const lineKey = weightedMode(lineValues);
  const line = lineKey != null ? (JSON.parse(lineKey) as WordLineSpacing) : undefined;
  const indentKey = weightedMode(indentValues);
  const indent = indentKey != null ? Number(indentKey) : undefined;
  const rFontsXml = weightedMode(rFontsValues);
  const rawKey = weightedMode(
    [...rawFamily.entries()].map(([value, weight]) => ({ value, weight })),
  );

  const total = samples.reduce((sum, flat) => sum + flat.paragraph.text.trim().length, 0);
  const matched = samples.reduce((sum, flat) => {
    const mark = dominantRunMark(flat.paragraph);
    const sameFamily = canonicalFontFamily(mark.fontFamily) === family;
    const size = markSizePt(mark);
    const sameSize =
      fontSizePt == null ||
      (size != null && Math.abs(size - fontSizePt) <= GB_BODY.sizePtTolerance);
    return sameFamily && sameSize ? sum + flat.paragraph.text.trim().length : sum;
  }, 0);

  const labelZh = [family ?? "字体未标", sizeLabel(fontSizePx, fontSizePt) ?? ""]
    .filter(Boolean)
    .join("　");

  return {
    sampleCount: samples.length,
    ...(family ? { fontFamily: family } : {}),
    ...(rawKey ? { fontFamilyRaw: rawKey } : {}),
    ...(rFontsXml ? { rFontsXml } : {}),
    ...(fontSizePx != null ? { fontSizePx } : {}),
    ...(fontSizePt != null ? { fontSizePt } : {}),
    ...(line ? { line } : {}),
    ...(indent != null ? { firstIndentChars: indent } : {}),
    share: total > 0 ? Math.round((matched / total) * 100) / 100 : 0,
    labelZh: labelZh || "无法识别正文主流格式",
  };
}

/**
 * LawMind 新写入的文字该用什么格式。
 * `imported` 一律跟随原文主流格式；只有从零起草/律师要求整体套模板时才用国标。
 */
export type LawmindTextFormat = {
  source: "document-self" | "gb-t-9704-2012";
  /** 原文 `<w:rFonts …/>`，优先于字体栈写回。 */
  rFontsXml?: string;
  fontFamily?: string;
  fontSizePx?: number;
  fontSizePt?: number;
  line?: WordLineSpacing;
  firstIndentChars?: number;
  labelZh: string;
};

export function formatForLawmindText(params: {
  mode: FormatAuditMode;
  blocks: readonly WordLayoutBlock[];
}): LawmindTextFormat {
  if (params.mode === "imported") {
    const profile = buildDocumentFormatProfile(params.blocks);
    return {
      source: "document-self",
      ...(profile.rFontsXml ? { rFontsXml: profile.rFontsXml } : {}),
      ...(profile.fontFamily ? { fontFamily: profile.fontFamily } : {}),
      ...(profile.fontSizePx != null ? { fontSizePx: profile.fontSizePx } : {}),
      ...(profile.fontSizePt != null ? { fontSizePt: profile.fontSizePt } : {}),
      ...(profile.line ? { line: profile.line } : {}),
      ...(profile.firstIndentChars != null ? { firstIndentChars: profile.firstIndentChars } : {}),
      labelZh: profile.labelZh,
    };
  }
  return {
    source: "gb-t-9704-2012",
    fontFamily: "仿宋_GB2312",
    fontSizePx: Math.round(GB_BODY.fontPt * PT_TO_PX * 10) / 10,
    fontSizePt: GB_BODY.fontPt,
    line: { rule: "exact", px: Math.round(GB_BODY.linePt * PT_TO_PX * 10) / 10 },
    firstIndentChars: GB_BODY.firstIndentChars,
    labelZh: "仿宋　三号（16pt）",
  };
}

class FindingSink {
  readonly findings: FormatAuditFinding[] = [];
  omitted = 0;
  error = 0;
  warning = 0;
  info = 0;

  add(finding: FormatAuditFinding): void {
    if (finding.severity === "error") {
      this.error += 1;
    } else if (finding.severity === "warning") {
      this.warning += 1;
    } else {
      this.info += 1;
    }
    if (this.findings.length < REPORT_LIMIT) {
      this.findings.push(finding);
    } else {
      this.omitted += 1;
    }
  }
}

export function auditDocumentFormat(input: FormatAuditInput): FormatAuditReport {
  const flat = flattenParagraphs(input.blocks);
  const profile = buildDocumentFormatProfile(input.blocks);
  const unchecked: string[] = [];
  const sink = new FindingSink();

  if (input.mode === "imported") {
    auditImported({ ...input, flat }, profile, sink, unchecked);
    return finish(input.mode, profile, sink, unchecked, {
      id: "document-self",
      labelZh: "跟随原文格式",
      provisional: false,
      requestedByLawyer: false,
      noticeZh:
        "外来件以文件自身的主流格式为准：LawMind 新增/改写的内容跟随原文，不套用公文模板；" +
        "只有律师明确要求时才整体调整。",
    });
  }

  const requestedByLawyer = input.mode === "retemplate";
  auditOfficial({ ...input, flat }, sink, unchecked);
  return finish(input.mode, profile, sink, unchecked, {
    id: GB_T_9704_ID,
    labelZh: "党政机关公文格式 GB/T 9704-2012（草案）",
    provisional: true,
    requestedByLawyer,
    noticeZh: requestedByLawyer
      ? `${GB_T_9704_NOTICE_ZH}（本次是律师明确要求整体套用）`
      : GB_T_9704_NOTICE_ZH,
    todoMarker: FORMAT_STANDARD_TODO_MARKER,
  });
}

function finish(
  mode: FormatAuditMode,
  profile: DocumentFormatProfile,
  sink: FindingSink,
  unchecked: string[],
  standard: FormatAuditStandard,
): FormatAuditReport {
  const findings = sink.findings;
  const counts = { error: sink.error, warning: sink.warning, info: sink.info };
  const parts: string[] = [];
  if (counts.error > 0) {
    parts.push(`${counts.error} 处不符合`);
  }
  if (counts.warning > 0) {
    parts.push(`${counts.warning} 处需确认`);
  }
  if (counts.error === 0 && counts.warning === 0) {
    parts.push("已检查项未见问题");
  }
  if (unchecked.length > 0) {
    parts.push(`${unchecked.length} 项未检查`);
  }
  return {
    mode,
    standard,
    profile,
    findings,
    unchecked,
    omittedFindings: sink.omitted,
    counts,
    ok: counts.error === 0,
    summaryZh: `格式体检：${parts.join("，")}。`,
  };
}

function auditOfficial(
  input: FormatAuditInput & { flat: FlatParagraph[] },
  sink: FindingSink,
  unchecked: string[],
): void {
  const basisZh = input.mode === "retemplate" ? "律师要求整体套用（国标草案）" : "国标草案";
  checkPage(input.page, sink, basisZh, unchecked);
  checkBody(input.flat, sink, basisZh, unchecked);
  checkHeadings(input.flat, sink, basisZh);
  checkTitle(input.flat, sink, basisZh, unchecked);
  checkDate(input.flat, sink, basisZh, unchecked);
  unchecked.push("页码（页脚未参与本检查）");
  unchecked.push("发文机关标志、红色分隔线、版记");
  unchecked.push("每面 22 行 × 每行 28 字（需要逐页排版结果，当前只查行距与字号）");
  if (input.hasTextBoxes) {
    unchecked.push("文本框内的文字与排版（框内是嵌套段落，当前不解析，含框段落也未核对）");
  }
}

function checkPage(
  page: WordPageBox,
  sink: FindingSink,
  basisZh: string,
  unchecked: string[],
): void {
  const tolerance = GB_PAGE.toleranceMm * MM_TO_PX;
  const checkSize = (actualPx: number | undefined, expectedMm: number, labelZh: string) => {
    if (actualPx == null) {
      unchecked.push(`${labelZh}（文件未写出）`);
      return;
    }
    const expectedPx = expectedMm * MM_TO_PX;
    if (Math.abs(actualPx - expectedPx) > tolerance) {
      sink.add({
        code: "page.size",
        severity: "error",
        messageZh: `${labelZh}不符合公文用纸`,
        actual: `${Math.round((actualPx / MM_TO_PX) * 10) / 10}mm`,
        expected: `${expectedMm}mm`,
        basisZh,
      });
    }
  };
  checkSize(page.widthPx, GB_PAGE.widthMm, "纸张宽度");
  checkSize(page.heightPx, GB_PAGE.heightMm, "纸张高度");

  const margins: Array<[number, number, string]> = [
    [page.marginTopPx, GB_PAGE.marginTopMm, "上边距"],
    [page.marginRightPx, GB_PAGE.marginRightMm, "右边距"],
    [page.marginBottomPx, GB_PAGE.marginBottomMm, "下边距"],
    [page.marginLeftPx, GB_PAGE.marginLeftMm, "左边距"],
  ];
  for (const [actualPx, expectedMm, labelZh] of margins) {
    const expectedPx = expectedMm * MM_TO_PX;
    if (Math.abs(actualPx - expectedPx) > tolerance) {
      sink.add({
        code: "page.margin",
        severity: "error",
        messageZh: `${labelZh}不符合公文版心`,
        actual: `${Math.round((actualPx / MM_TO_PX) * 10) / 10}mm`,
        expected: `${expectedMm}mm ±1mm`,
        basisZh,
      });
    }
  }
}

function checkBody(
  flat: FlatParagraph[],
  sink: FindingSink,
  basisZh: string,
  unchecked: string[],
): void {
  let seen = 0;
  let unknownFont = 0;
  for (const item of flat) {
    if (!isBodySample(item)) {
      continue;
    }
    seen += 1;
    const { paragraph, index } = item;
    const mark = dominantRunMark(paragraph);
    const family = canonicalFontFamily(mark.fontFamily);
    const pt = markSizePt(mark);

    if (!family || pt == null) {
      unknownFont += 1;
      continue;
    }

    if (family !== GB_BODY.fontFamily) {
      sink.add({
        code: "body.font",
        severity: "error",
        messageZh: "正文字体不是仿宋",
        paragraphIndex: index,
        actual: family,
        expected: GB_BODY.fontFamily,
        basisZh,
      });
    }
    if (Math.abs(pt - GB_BODY.fontPt) > GB_BODY.sizePtTolerance) {
      sink.add({
        code: "body.size",
        severity: "error",
        messageZh: "正文字号不是三号",
        paragraphIndex: index,
        actual: `${pt}pt`,
        expected: `${GB_BODY.fontPt}pt（三号）`,
        basisZh,
      });
    }

    if (!paragraph.line) {
      sink.add({
        code: "body.line",
        severity: "error",
        messageZh: "正文没有设置固定行距",
        paragraphIndex: index,
        actual: "未设置（Word 默认单倍）",
        expected: `${GB_BODY.linePt} 磅固定值`,
        basisZh,
      });
    } else {
      const exactPt = paragraph.line.rule === "auto" ? undefined : paragraph.line.px / PT_TO_PX;
      const ok = exactPt != null && exactPt >= GB_BODY.linePtMin && exactPt <= GB_BODY.linePtMax;
      if (!ok) {
        sink.add({
          code: "body.line",
          severity: "error",
          messageZh: "正文行距不符合每面 22 行",
          paragraphIndex: index,
          actual: lineLabel(paragraph.line),
          expected: `${GB_BODY.linePt} 磅固定值`,
          basisZh,
        });
      }
    }

    if (!isRecipientLine(paragraph.text)) {
      const indent = firstIndentChars(paragraph, mark.fontSizePx);
      if (
        indent == null ||
        Math.abs(indent - GB_BODY.firstIndentChars) > GB_BODY.indentCharsTolerance
      ) {
        sink.add({
          code: "body.indent",
          severity: "warning",
          messageZh: "正文首行缩进不是 2 字",
          paragraphIndex: index,
          actual: indent == null ? "无法判定" : `${indent.toFixed(2)} 字`,
          expected: `${GB_BODY.firstIndentChars} 字`,
          basisZh,
        });
      }
    }
  }

  if (seen === 0) {
    unchecked.push("正文格式（未识别到正文段落）");
  }
  if (unknownFont > 0) {
    unchecked.push(`正文格式（${unknownFont} 段未写出字体或字号）`);
  }
}

function checkHeadings(flat: FlatParagraph[], sink: FindingSink, basisZh: string): void {
  for (const item of flat) {
    if (item.inTable) {
      continue;
    }
    const level = headingLevel(item.paragraph);
    if (level == null) {
      continue;
    }
    const spec = GB_HEADINGS.find((heading) => heading.level === level);
    if (!spec) {
      continue;
    }
    const mark = dominantRunMark(item.paragraph);
    const family = canonicalFontFamily(mark.fontFamily);
    if (!family) {
      continue;
    }
    const pt = markSizePt(mark);
    if (family !== spec.fontFamily) {
      sink.add({
        code: `heading${level}.font`,
        severity: "error",
        messageZh: `${level} 级标题字体不符合`,
        paragraphIndex: item.index,
        actual: family,
        expected: spec.fontFamily,
        basisZh,
      });
    }
    if (pt != null && Math.abs(pt - GB_BODY.fontPt) > GB_BODY.sizePtTolerance) {
      sink.add({
        code: `heading${level}.size`,
        severity: "warning",
        messageZh: `${level} 级标题字号不是三号`,
        paragraphIndex: item.index,
        actual: `${pt}pt`,
        expected: `${GB_BODY.fontPt}pt（三号）`,
        basisZh,
      });
    }
  }
}

function checkTitle(
  flat: FlatParagraph[],
  sink: FindingSink,
  basisZh: string,
  unchecked: string[],
): void {
  const first = flat.find((item) => item.paragraph.text.trim().length > 0);
  if (!first) {
    unchecked.push("标题（空文档）");
    return;
  }
  if (first.paragraph.align !== "center") {
    unchecked.push("标题（首段未居中，无法确认是否为公文标题）");
    return;
  }
  const mark = dominantRunMark(first.paragraph);
  const family = canonicalFontFamily(mark.fontFamily);
  const pt = markSizePt(mark);
  if (family && family !== GB_TITLE.fontFamily) {
    sink.add({
      code: "title.font",
      severity: "error",
      messageZh: "公文标题字体不是小标宋",
      paragraphIndex: first.index,
      actual: family,
      expected: GB_TITLE.fontFamily,
      basisZh,
    });
  }
  if (pt != null && Math.abs(pt - GB_TITLE.fontPt) > GB_BODY.sizePtTolerance) {
    sink.add({
      code: "title.size",
      severity: "error",
      messageZh: "公文标题字号不是二号",
      paragraphIndex: first.index,
      actual: `${pt}pt`,
      expected: `${GB_TITLE.fontPt}pt（二号）`,
      basisZh,
    });
  }
}

const DATE_LINE =
  /(\d{4}|[〇零一二三四五六七八九○]{4})\s*年\s*(\d{1,2}|[〇零一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[〇零一二三四五六七八九十]+)\s*日/;

function checkDate(
  flat: FlatParagraph[],
  sink: FindingSink,
  basisZh: string,
  unchecked: string[],
): void {
  let hit: FlatParagraph | undefined;
  for (const item of flat) {
    // 表格里的日期（交付清单、签署页）不是成文日期。
    if (!item.inTable && DATE_LINE.test(item.paragraph.text)) {
      hit = item;
    }
  }
  if (!hit) {
    unchecked.push("成文日期（未找到日期行）");
    return;
  }
  const text = hit.paragraph.text.trim();
  const match = DATE_LINE.exec(text);
  if (!match) {
    unchecked.push("成文日期（日期格式无法解析）");
    return;
  }
  const [, year, month, day] = match;
  const arabic = /^\d+$/.test(year) && /^\d+$/.test(month) && /^\d+$/.test(day);
  if (!arabic) {
    sink.add({
      code: "date.numerals",
      severity: "error",
      messageZh: "成文日期应使用阿拉伯数字",
      paragraphIndex: hit.index,
      actual: text,
      expected: "2026年10月20日",
      basisZh,
    });
  } else {
    if (/^0\d/.test(month) || /^0\d/.test(day)) {
      sink.add({
        code: "date.padding",
        severity: "warning",
        messageZh: "成文日期的月、日不编虚位",
        paragraphIndex: hit.index,
        actual: text,
        expected: "1 不写成 01",
        basisZh,
      });
    }
  }
  if (hit.paragraph.align !== "right") {
    sink.add({
      code: "date.align",
      severity: "warning",
      messageZh: "成文日期一般右空四字编排",
      paragraphIndex: hit.index,
      actual: alignLabel(hit.paragraph.align),
      expected: "右对齐",
      basisZh,
    });
  }
}

function auditImported(
  input: FormatAuditInput & { flat: FlatParagraph[] },
  profile: DocumentFormatProfile,
  sink: FindingSink,
  unchecked: string[],
): void {
  unchecked.push("页面、页边距、行距：外来件保持原样，不按公文模板检查");
  unchecked.push("全文版式：只有律师明确要求时才整体套用模板");
  if (input.hasTextBoxes) {
    unchecked.push("文本框内的文字与排版（框内是嵌套段落，当前不解析，含框段落也未核对）");
  }

  if (profile.sampleCount === 0) {
    sink.add({
      code: "imported.no-profile",
      severity: "warning",
      messageZh: "未识别到正文主流格式，LawMind 新增内容没有可跟随的基准",
      expected: "请指定一段原文作为基准段落",
      basisZh: "跟随原文",
    });
    return;
  }

  if (profile.share < 0.6) {
    sink.add({
      code: "imported.unstable",
      severity: "warning",
      messageZh: `文件自身格式不统一（主流格式只占 ${Math.round(profile.share * 100)}%），跟随原文会有歧义`,
      actual: profile.labelZh,
      expected: "请指定一段原文作为基准段落",
      basisZh: "跟随原文",
    });
  }

  if (!input.lawmindParagraphs?.length) {
    return;
  }

  const expectedLabel = fontLabel(profile.fontFamily, profile.fontSizePx, profile.fontSizePt);
  for (const index of input.lawmindParagraphs) {
    const item = input.flat[index];
    if (!item) {
      continue;
    }
    const mark = dominantRunMark(item.paragraph);
    const family = canonicalFontFamily(mark.fontFamily);
    const pt = markSizePt(mark);
    const expectedPt =
      profile.fontSizePt ?? (profile.fontSizePx != null ? pxToPt(profile.fontSizePx) : undefined);

    if (family && profile.fontFamily && family !== profile.fontFamily) {
      sink.add({
        code: "imported.font",
        severity: "error",
        messageZh: "LawMind 写入的段落字体跟原文不一致",
        paragraphIndex: index,
        actual: family,
        expected: profile.fontFamily,
        basisZh: "跟随原文主流格式",
      });
    }
    if (pt != null && expectedPt != null && Math.abs(pt - expectedPt) > GB_BODY.sizePtTolerance) {
      sink.add({
        code: "imported.size",
        severity: "error",
        messageZh: "LawMind 写入的段落字号跟原文不一致",
        paragraphIndex: index,
        actual: `${pt}pt`,
        expected: expectedLabel ?? `${expectedPt}pt`,
        basisZh: "跟随原文主流格式",
      });
    }
    const indent = firstIndentChars(item.paragraph, mark.fontSizePx);
    if (
      profile.firstIndentChars != null &&
      indent != null &&
      Math.abs(indent - profile.firstIndentChars) > GB_BODY.indentCharsTolerance
    ) {
      sink.add({
        code: "imported.indent",
        severity: "warning",
        messageZh: "LawMind 写入的段落缩进跟原文不一致",
        paragraphIndex: index,
        actual: `${indent.toFixed(2)} 字`,
        expected: `${profile.firstIndentChars.toFixed(2)} 字`,
        basisZh: "跟随原文主流格式",
      });
    }
  }
}

/** 给律师看的纯文本清单。 */
export function renderFormatAuditText(report: FormatAuditReport): string {
  const lines: string[] = [];
  const scope =
    report.mode === "imported"
      ? "外来件 · 跟随原文"
      : report.mode === "retemplate"
        ? "整体套用模板 · 律师要求"
        : "从零起草 · 国标草案";
  lines.push(`【格式体检 · ${scope}】${report.summaryZh}`);
  if (report.standard.provisional) {
    lines.push(report.standard.noticeZh);
  }
  if (report.mode === "imported") {
    lines.push(
      `原文主流格式：${report.profile.labelZh}（一致率 ${Math.round(report.profile.share * 100)}%）`,
    );
  }
  for (const finding of report.findings) {
    const mark = finding.severity === "error" ? "✗" : finding.severity === "warning" ? "⚠" : "·";
    const where = finding.paragraphIndex != null ? `第 ${finding.paragraphIndex + 1} 段 ` : "";
    const detail =
      finding.actual || finding.expected
        ? `（现：${finding.actual ?? "—"}；应：${finding.expected ?? "—"}）`
        : "";
    lines.push(`${mark} ${where}${finding.messageZh}${detail}`);
  }
  if (report.omittedFindings > 0) {
    lines.push(`…另有 ${report.omittedFindings} 条同类问题未展开`);
  }
  if (report.unchecked.length > 0) {
    lines.push("未检查（不当作通过）：");
    for (const item of report.unchecked) {
      lines.push(`· ${item}`);
    }
  }
  return lines.join("\n");
}
