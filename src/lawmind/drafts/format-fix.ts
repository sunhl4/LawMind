/**
 * L2「一次手术」：把格式统一写成 Word 格式修订，落到一份副本上。
 *
 * 边界（刻意保守）：
 * - 只动 A 层：正文字体、字号、固定行距、首行缩进。标题层级、编号重排、页边距、
 *   成文日期位置都属于「要先判断」的 B 层，本模块不碰。
 * - 只改被点名的段落：`imported` 模式只改 LawMind 写过的段落；整篇套模板必须
 *   由律师显式要求（调用方传全部正文段）。
 * - 写成 `w:rPrChange` / `w:pPrChange`，律师在 Word 里能逐条接受/拒绝，不是静默美化。
 * - 永远写副本，不改原文件；写前写后对账原有 `w:ins` / `w:del`，丢一条就报错。
 */

import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { auditDocumentFormat, type FormatAuditMode } from "./document-format-audit.js";
import { verifyDocxRevisionPreservation } from "./word-revision/preservation-file.js";
import type {
  WordLayoutBlock,
  WordLayoutParagraph,
  WordLineSpacing,
} from "./word-surface-layout.js";
import { readDocxDocumentLayout } from "./word-surface.js";

export type FormatFixKind = "body.font" | "body.size" | "body.line" | "body.indent";

export type FormatFixTarget = {
  fontFamily?: string;
  /** 原文的原始 `<w:rFonts …/>`；外来件优先用它，避免东亚字体名漂移。 */
  rFontsXml?: string;
  /** Word 半磅值：32 = 16pt（三号）。 */
  halfPt?: number;
  line?: WordLineSpacing;
  firstIndentChars?: number;
};

export type FormatFixPlan = {
  /** 要改的段落（阅读序，0 基）与要改的项。 */
  fixes: Array<{ paragraphIndex: number; text: string; kinds: FormatFixKind[] }>;
  target: FormatFixTarget;
  /** 明确不改的项，避免「看起来全改了」。 */
  skippedKinds: string[];
};

export type FormatFixResult = {
  ok: boolean;
  outputPath?: string;
  appliedParagraphs?: number;
  appliedRuns?: number;
  plan?: FormatFixPlan;
  /** 原有修订对账结果；`verified=false` 表示无法核验，不等于通过。 */
  revisions?: { verified: boolean; beforeCount: number; afterCount: number; note?: string };
  error?: string;
  code?: string;
  warning?: string;
};

const RUN_RE = /<w:r\b[^>]*(?:\/>|>[\s\S]*?<\/w:r>)/g;
const TRACK_WRAPPER_RE = /<w:(ins|del|moveFrom|moveTo)\b[^>]*>[\s\S]*?<\/w:\1>/g;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 段落里律师看得见的那部分文字（去掉已删除文字、文本框内容、域代码）。 */
function visibleParagraphText(xml: string): string {
  const withoutDeleted = xml
    .replace(/<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/g, "")
    .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "")
    .replace(/<w:moveFrom\b[^>]*>[\s\S]*?<\/w:moveFrom>/g, "")
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "");
  return normalizeText(withoutDeleted.replace(/<[^>]*>/g, ""));
}

type ParagraphHit = { xml: string; start: number; end: number };

/**
 * 文档顺序里的顶层段落（含表格单元格内的段落，不含文本框里的段落）。
 *
 * 用深度扫描而不是 `<w:p>[\s\S]*?</w:p>` 正则：文本框会在段落里再嵌 `<w:p>`，
 * 惰性正则会提前收尾，一旦拿这个区间做替换就会把 XML 截断成坏文件。
 * 排版提取器不深入文本框，所以只取顶层段落，序号才能和体检结果对齐。
 */
function scanTopLevelParagraphs(xml: string): ParagraphHit[] {
  const ranges: ParagraphHit[] = [];
  const tagRe = /<(\/?)w:p\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = -1;
  for (const match of xml.matchAll(tagRe)) {
    const at = match.index ?? 0;
    const closing = match[1] === "/";
    const selfClosing = match[2] === "/";
    if (closing) {
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        if (start >= 0) {
          const end = at + match[0].length;
          ranges.push({ xml: xml.slice(start, end), start, end });
          start = -1;
        }
      }
      continue;
    }
    if (selfClosing) {
      if (depth === 0) {
        const end = at + match[0].length;
        ranges.push({ xml: match[0], start: at, end });
      }
      continue;
    }
    if (depth === 0) {
      start = at;
    }
    depth += 1;
  }
  return ranges;
}

function paragraphMatches(hit: ParagraphHit, text: string): boolean {
  const wanted = normalizeText(text);
  return wanted.length > 0 && visibleParagraphText(hit.xml) === wanted;
}

type LocatedParagraph = {
  hit: ParagraphHit;
  /** `ordinal` = 位置和体检一致；`text` = 按唯一原文找回。 */
  via: "ordinal" | "text";
};

/**
 * 先按体检时的段落序号定位，再用原文复核；序号对不上才退回唯一原文查找。
 * 两样都对不上就不改——宁可少改，也不能改到别的段落上。
 */
function locateParagraph(
  xml: string,
  list: readonly ParagraphHit[],
  target: { paragraphIndex: number; text: string },
): LocatedParagraph | { reason: string } {
  const byOrdinal = list[target.paragraphIndex];
  if (byOrdinal && paragraphMatches(byOrdinal, target.text)) {
    return { hit: byOrdinal, via: "ordinal" };
  }
  const wanted = normalizeText(target.text);
  const hits = list.filter((hit) => wanted.length > 0 && paragraphMatches(hit, target.text));
  if (hits.length === 1 && hits[0]) {
    return { hit: hits[0], via: "text" };
  }
  if (hits.length > 1) {
    return { reason: "同样的文字在文件里出现了不止一处，未改（避免改错地方）" };
  }
  return {
    reason: byOrdinal
      ? "这一段的位置和体检时对不上，未改（文件可能已被改过）"
      : "文件里找不到这一段，未改（文件可能已被改过）",
  };
}

function elementInner(xml: string, name: string): { inner: string; found: boolean } {
  const match = xml.match(new RegExp(`<w:${name}\\b[^>]*>([\\s\\S]*?)</w:${name}>`));
  if (match) {
    return { inner: match[1] ?? "", found: true };
  }
  return { inner: "", found: new RegExp(`<w:${name}\\b[^>]*/>`).test(xml) };
}

function removeElement(xml: string, name: string): string {
  return xml
    .replace(new RegExp(`<w:${name}\\b[^>]*/>`, "g"), "")
    .replace(new RegExp(`<w:${name}\\b[^>]*>[\\s\\S]*?</w:${name}>`, "g"), "");
}

/**
 * `w:pPr` 的子元素是**有序**的：`w:spacing` 必须在 `w:ind` 之前，两者都在 `w:jc`
 * 之前，最后才是 `w:rPr` / `w:sectPr` / `w:pPrChange`。追加到末尾会让 Word 认为
 * 文件结构不对（打开时提示"内容有问题"），所以按 schema 顺序插到正确位置。
 */
const PPR_CHILD_ORDER = [
  "pStyle",
  "keepNext",
  "keepLines",
  "pageBreakBefore",
  "framePr",
  "widowControl",
  "numPr",
  "suppressLineNumbers",
  "pBdr",
  "shd",
  "tabs",
  "suppressAutoHyphens",
  "kinsoku",
  "wordWrap",
  "overflowPunct",
  "topLinePunct",
  "autoSpaceDE",
  "autoSpaceDN",
  "bidi",
  "adjustRightInd",
  "snapToGrid",
  "spacing",
  "ind",
  "contextualSpacing",
  "mirrorIndents",
  "suppressOverlap",
  "jc",
  "textDirection",
  "textAlignment",
  "textboxTightWrap",
  "outlineLvl",
  "divId",
  "cnfStyle",
  "rPr",
  "sectPr",
  "pPrChange",
] as const;

function insertPPrChild(pPrInner: string, childName: string, xml: string): string {
  const rank = PPR_CHILD_ORDER.indexOf(childName as (typeof PPR_CHILD_ORDER)[number]);
  if (rank < 0) {
    return `${pPrInner}${xml}`;
  }
  for (const match of pPrInner.matchAll(/<w:([A-Za-z]+)\b/g)) {
    const existingRank = PPR_CHILD_ORDER.indexOf(
      (match[1] ?? "") as (typeof PPR_CHILD_ORDER)[number],
    );
    if (existingRank > rank) {
      const at = match.index ?? 0;
      return `${pPrInner.slice(0, at)}${xml}${pPrInner.slice(at)}`;
    }
  }
  return `${pPrInner}${xml}`;
}

/** 在已有 `w:spacing` 上改行距，保留段前后间距等其它属性。 */
function patchSpacing(pPrInner: string, line: WordLineSpacing): string {
  const existing = pPrInner.match(/<w:spacing\b[^>]*\/>/)?.[0];
  if (!existing) {
    if (line.rule === "auto") {
      return insertPPrChild(
        pPrInner,
        "spacing",
        `<w:spacing w:line="${Math.round(line.multiple * 240)}" w:lineRule="auto"/>`,
      );
    }
    const twips = Math.round((line.px / (96 / 72)) * 20);
    return insertPPrChild(
      pPrInner,
      "spacing",
      `<w:spacing w:line="${twips}" w:lineRule="${line.rule}"/>`,
    );
  }
  const next =
    line.rule === "auto"
      ? existing
          .replace(/\s*w:line="[^"]*"/, ` w:line="${Math.round(line.multiple * 240)}"`)
          .replace(/\s*w:lineRule="[^"]*"/, ` w:lineRule="auto"`)
      : existing
          .replace(/\s*w:line="[^"]*"/, ` w:line="${Math.round((line.px / (96 / 72)) * 20)}"`)
          .replace(/\s*w:lineRule="[^"]*"/, ` w:lineRule="${line.rule}"`);
  const withRule = /w:lineRule=/.test(next)
    ? next
    : next.replace(/^<w:spacing\b/, `<w:spacing w:lineRule="${line.rule}"`);
  return pPrInner.replace(existing, withRule);
}

/** 首行缩进 2 字。悬挂缩进（编号/列表）保持原样——那是 B 层。 */
function patchFirstLineIndent(pPrInner: string, chars: number): string {
  if (/<w:ind\b[^>]*\bw:hanging(?:Chars)?="/.test(pPrInner)) {
    return pPrInner;
  }
  const hundredths = Math.round(chars * 100);
  const existing = pPrInner.match(/<w:ind\b[^>]*\/>/)?.[0];
  if (!existing) {
    return insertPPrChild(pPrInner, "ind", `<w:ind w:firstLineChars="${hundredths}"/>`);
  }
  const stripped = existing
    .replace(/\s*w:firstLineChars="[^"]*"/, "")
    .replace(/\s*w:firstLine="[^"]*"/, "");
  const next = stripped.replace(/\/>$/, ` w:firstLineChars="${hundredths}"/>`);
  return pPrInner.replace(existing, next);
}

function patchRPr(
  rPrInner: string,
  target: { fontFamily?: string; rFontsXml?: string; halfPt?: number },
): string {
  let next = rPrInner;
  const fonts =
    target.rFontsXml?.trim() ||
    (target.fontFamily
      ? `<w:rFonts w:ascii="${target.fontFamily}" w:hAnsi="${target.fontFamily}" w:eastAsia="${target.fontFamily}" w:hint="eastAsia"/>`
      : undefined);
  if (fonts) {
    next = /<w:rFonts\b[^>]*\/>/.test(next)
      ? next.replace(/<w:rFonts\b[^>]*\/>/, fonts)
      : `${next}${fonts}`;
  }
  if (target.halfPt) {
    const half = Math.round(target.halfPt);
    next = next
      .replace(/<w:sz\b[^>]*\/>/g, `<w:sz w:val="${half}"/>`)
      .replace(/<w:szCs\b[^>]*\/>/g, `<w:szCs w:val="${half}"/>`);
    if (!/<w:sz\b/.test(next)) {
      next = `${next}<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`;
    }
    if (!/<w:szCs\b/.test(next)) {
      next = `${next}<w:szCs w:val="${half}"/>`;
    }
  }
  return next;
}

function trackRanges(xml: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of xml.matchAll(TRACK_WRAPPER_RE)) {
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}

function insideRanges(at: number, ranges: ReadonlyArray<{ start: number; end: number }>): boolean {
  return ranges.some((range) => at >= range.start && at < range.end);
}

/** 只给普通 run 加格式修订；`w:ins` / `w:del` 里的原有修订一个字都不碰。 */
function patchRunsInParagraph(
  paragraphXml: string,
  target: { fontFamily?: string; rFontsXml?: string; halfPt?: number },
  track: { id: string; author: string; date: string },
): { xml: string; patched: number } {
  const ranges = trackRanges(paragraphXml);
  let patched = 0;
  const xml = paragraphXml.replace(RUN_RE, (runXml, offset: number) => {
    if (insideRanges(offset, ranges) || runXml.endsWith("/>")) {
      return runXml;
    }
    if (!/<w:t\b/.test(runXml)) {
      return runXml;
    }
    const { inner: rPrInner, found } = elementInner(runXml, "rPr");
    const oldInner = removeElement(rPrInner, "rPrChange");
    const nextInner = patchRPr(oldInner, target);
    if (nextInner === oldInner) {
      return runXml;
    }
    const change = `<w:rPrChange w:id="${track.id}" w:author="${track.author}" w:date="${track.date}"><w:rPr>${oldInner}</w:rPr></w:rPrChange>`;
    const rPrXml = `<w:rPr>${nextInner}${change}</w:rPr>`;
    const nextRun = found
      ? runXml.replace(/<w:rPr\b[^>]*(?:\/>|>[\s\S]*?<\/w:rPr>)/, rPrXml)
      : runXml.replace(/(<w:r\b[^>]*>)/, `$1${rPrXml}`);
    if (nextRun === runXml) {
      return runXml;
    }
    patched += 1;
    return nextRun;
  });
  return { xml, patched };
}

export type ApplyFormatFixesInput = {
  documentXml: string;
  blocks: readonly WordLayoutBlock[];
  targets: ReadonlyArray<{ paragraphIndex: number; text: string; kinds: readonly FormatFixKind[] }>;
  target: FormatFixTarget;
  author: string;
  now: string;
  nextTrackId: () => string;
};

/** 纯函数：给 document.xml 加格式修订。返回新 xml 与被跳过的段落。 */
export function applyFormatFixesToXml(input: ApplyFormatFixesInput): {
  xml: string;
  appliedParagraphs: number;
  appliedRuns: number;
  skipped: Array<{ paragraphIndex: number; reason: string }>;
} {
  let appliedRuns = 0;
  const skipped: Array<{ paragraphIndex: number; reason: string }> = [];
  // 只扫一次、一次性定位：改完一段再扫会让后续序号随文本长度漂移。
  // 替换从右往左做，前面段落的偏移量保持有效（与 officecli 落改同一惯例）。
  const list = scanTopLevelParagraphs(input.documentXml);
  const replacements: Array<{ start: number; end: number; xml: string }> = [];
  const seen = new Set<number>();

  for (const target of input.targets) {
    if (seen.has(target.paragraphIndex)) {
      continue;
    }
    seen.add(target.paragraphIndex);

    const located = locateParagraph(input.documentXml, list, target);
    if ("reason" in located) {
      skipped.push({ paragraphIndex: target.paragraphIndex, reason: located.reason });
      continue;
    }
    const hit = located.hit;
    if (hit.xml.includes("<w:txbxContent")) {
      // 框内是嵌套段落：既不按框内文字改，也不按框外文字改，整段留给人工。
      skipped.push({
        paragraphIndex: target.paragraphIndex,
        reason: "这段含文本框，未改（框内排版不在自动修范围内）",
      });
      continue;
    }
    const wantsRuns = target.kinds.includes("body.font") || target.kinds.includes("body.size");
    const wantsParagraph =
      target.kinds.includes("body.line") || target.kinds.includes("body.indent");
    let paragraphXml = hit.xml;
    const beforeRuns = appliedRuns;

    if (wantsRuns) {
      const patched = patchRunsInParagraph(
        paragraphXml,
        {
          ...(input.target.fontFamily ? { fontFamily: input.target.fontFamily } : {}),
          ...(input.target.rFontsXml ? { rFontsXml: input.target.rFontsXml } : {}),
          ...(input.target.halfPt ? { halfPt: input.target.halfPt } : {}),
        },
        { id: input.nextTrackId(), author: input.author, date: input.now },
      );
      paragraphXml = patched.xml;
      appliedRuns += patched.patched;
    }

    if (wantsParagraph) {
      const openEnd = paragraphXml.indexOf(">");
      const close = paragraphXml.lastIndexOf("</w:p>");
      if (openEnd > 0 && close > openEnd) {
        const open = paragraphXml.slice(0, openEnd + 1);
        const inner = paragraphXml.slice(openEnd + 1, close);
        const pPr = elementInner(inner, "pPr").inner;
        let nextPPr = removeElement(pPr, "pPrChange");
        const beforePPr = nextPPr;
        if (input.target.line && target.kinds.includes("body.line")) {
          nextPPr = patchSpacing(nextPPr, input.target.line);
        }
        if (input.target.firstIndentChars != null && target.kinds.includes("body.indent")) {
          nextPPr = patchFirstLineIndent(nextPPr, input.target.firstIndentChars);
        }
        if (nextPPr !== beforePPr) {
          const change = `<w:pPrChange w:id="${input.nextTrackId()}" w:author="${input.author}" w:date="${input.now}"><w:pPr>${beforePPr}</w:pPr></w:pPrChange>`;
          const pPrXml = `<w:pPr>${nextPPr}${change}</w:pPr>`;
          const withoutPPr = inner.replace(/<w:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/w:pPr>)/, "");
          paragraphXml = `${open}${pPrXml}${withoutPPr}</w:p>`;
        }
      }
    }

    if (paragraphXml === hit.xml) {
      // 说清「为什么没改」，别把「不敢动」说成「本来就对」。
      const runCount = [...hit.xml.matchAll(RUN_RE)].length;
      const trackedRuns = [...hit.xml.matchAll(TRACK_WRAPPER_RE)].reduce(
        (sum, match) => sum + [...(match[0] ?? "").matchAll(RUN_RE)].length,
        0,
      );
      const reason =
        wantsRuns && appliedRuns === beforeRuns && runCount > 0 && trackedRuns >= runCount
          ? "这段文字全在别人的修改痕迹里，未动（保留原有修订）"
          : "本来就符合目标格式，未改";
      skipped.push({ paragraphIndex: target.paragraphIndex, reason });
      continue;
    }
    replacements.push({ start: hit.start, end: hit.end, xml: paragraphXml });
  }

  let xml = input.documentXml;
  for (const item of replacements.toSorted((a, b) => b.start - a.start)) {
    xml = `${xml.slice(0, item.start)}${item.xml}${xml.slice(item.end)}`;
  }

  return { xml, appliedParagraphs: replacements.length, appliedRuns, skipped };
}

function isBodyParagraph(paragraph: WordLayoutParagraph): boolean {
  const text = paragraph.text.trim();
  if (text.length < 8 || paragraph.align === "center" || paragraph.align === "right") {
    return false;
  }
  return (
    !/^[一二三四五六七八九十百]+、/.test(text) &&
    !/^[（(][一二三四五六七八九十百\d]+[）)]/.test(text)
  );
}

/** 依据体检结果生成改动计划。`imported` 只改 LawMind 写过的段落。 */
export function planFormatFixes(params: {
  mode: FormatAuditMode;
  page: Parameters<typeof auditDocumentFormat>[0]["page"];
  blocks: readonly WordLayoutBlock[];
  hasTextBoxes?: boolean;
  lawmindParagraphs?: readonly number[];
}): FormatFixPlan {
  const report = auditDocumentFormat({
    page: params.page,
    blocks: params.blocks,
    mode: params.mode,
    ...(params.hasTextBoxes ? { hasTextBoxes: true } : {}),
    ...(params.lawmindParagraphs ? { lawmindParagraphs: params.lawmindParagraphs } : {}),
  });

  const byIndex = new Map<number, FormatFixKind[]>();
  const kindOfCode = (code: string): FormatFixKind | undefined => {
    if (code === "body.font" || code === "imported.font") {
      return "body.font";
    }
    if (code === "body.size" || code === "imported.size") {
      return "body.size";
    }
    if (code === "body.line") {
      return "body.line";
    }
    if (code === "body.indent" || code === "imported.indent") {
      return "body.indent";
    }
    return undefined;
  };
  for (const finding of report.findings) {
    if (finding.paragraphIndex == null) {
      continue;
    }
    const kind = kindOfCode(finding.code);
    if (!kind) {
      continue;
    }
    const list = byIndex.get(finding.paragraphIndex) ?? [];
    if (!list.includes(kind)) {
      list.push(kind);
    }
    byIndex.set(finding.paragraphIndex, list);
  }

  const paragraphs: WordLayoutParagraph[] = [];
  const visit = (blocks: readonly WordLayoutBlock[]) => {
    for (const block of blocks) {
      if (block.kind === "paragraph") {
        paragraphs.push(block);
        continue;
      }
      for (const row of block.rows) {
        for (const cell of row) {
          visit(cell.blocks);
        }
      }
    }
  };
  visit(params.blocks);

  const fixes: FormatFixPlan["fixes"] = [];
  for (const [paragraphIndex, kinds] of [...byIndex.entries()].toSorted((a, b) => a[0] - b[0])) {
    const paragraph = paragraphs[paragraphIndex];
    if (!paragraph || !isBodyParagraph(paragraph)) {
      continue;
    }
    fixes.push({ paragraphIndex, text: paragraph.text.trim(), kinds });
  }

  const imported = params.mode === "imported";
  // profile 由同一次体检产出，不必再跑一遍（重复体检容易两边口径漂移）。
  const profile = imported ? report.profile : undefined;
  const halfPtFromProfile =
    profile?.fontSizePt != null
      ? profile.fontSizePt * 2
      : profile?.fontSizePx != null
        ? Math.round(profile.fontSizePx * 0.75) * 2
        : undefined;

  const target: FormatFixTarget = imported
    ? {
        ...(profile?.rFontsXml
          ? { rFontsXml: profile.rFontsXml }
          : profile?.fontFamily
            ? { fontFamily: profile.fontFamily }
            : {}),
        ...(halfPtFromProfile ? { halfPt: halfPtFromProfile } : {}),
        ...(profile?.line ? { line: profile.line } : {}),
        ...(profile?.firstIndentChars != null
          ? { firstIndentChars: profile.firstIndentChars }
          : {}),
      }
    : {
        fontFamily: "仿宋_GB2312",
        halfPt: 32,
        line: { rule: "exact", px: 37.3 },
        firstIndentChars: 2,
      };

  return {
    fixes,
    target,
    skippedKinds: [
      "标题层级与编号重排（要先判断）",
      "页边距与版面",
      "成文日期位置",
      "表格与图表版式",
    ],
  };
}

/** 写一份带格式修订的副本；原文件不动，原有修订逐条对账。 */
export async function applyFormatFixesToDocxFile(params: {
  inputAbs: string;
  outputAbs: string;
  mode: FormatAuditMode;
  author: string;
  lawmindParagraphs?: readonly number[];
  now?: string;
}): Promise<FormatFixResult> {
  if (params.inputAbs === params.outputAbs) {
    return {
      ok: false,
      code: "in_place_refused",
      error: "格式修订只写副本，不覆盖原文件。请指定另一个输出路径。",
    };
  }
  let layout: Awaited<ReturnType<typeof readDocxDocumentLayout>>;
  try {
    layout = await readDocxDocumentLayout(params.inputAbs);
  } catch (error) {
    return {
      ok: false,
      code: "unreadable_docx",
      error: `读不了这份 .docx：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const plan = planFormatFixes({
    mode: params.mode,
    page: layout.page,
    blocks: layout.blocks,
    ...(layout.hasTextBoxes ? { hasTextBoxes: true } : {}),
    ...(params.lawmindParagraphs ? { lawmindParagraphs: params.lawmindParagraphs } : {}),
  });
  if (plan.fixes.length === 0) {
    return {
      ok: true,
      plan,
      appliedParagraphs: 0,
      appliedRuns: 0,
      warning: "没有需要按 A 层自动改的正文段落（只出清单，不硬改）。",
    };
  }

  const zip = await JSZip.loadAsync(await fs.readFile(params.inputAbs));
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    return { ok: false, code: "not_a_docx", error: "这份文件里没有 word/document.xml。" };
  }
  const xml = await documentFile.async("string");

  const existingIds = [...xml.matchAll(/<w:(?:ins|del|rPrChange|pPrChange)\b[^>]*\bw:id="(\d+)"/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  let nextId = (existingIds.length > 0 ? Math.max(...existingIds) : 0) + 1;

  const applied = applyFormatFixesToXml({
    documentXml: xml,
    blocks: layout.blocks,
    targets: plan.fixes,
    target: plan.target,
    author: params.author,
    now: params.now ?? new Date().toISOString(),
    nextTrackId: () => String(nextId++),
  });

  if (applied.appliedParagraphs === 0) {
    return {
      ok: true,
      plan,
      appliedParagraphs: 0,
      appliedRuns: 0,
      warning: "体检指出了问题，但每一段都没能安全定位，未改动文件。",
    };
  }

  zip.file("word/document.xml", applied.xml);
  await fs.mkdir(path.dirname(params.outputAbs), { recursive: true }).catch(() => {});
  await fs.writeFile(params.outputAbs, await zip.generateAsync({ type: "nodebuffer" }));

  const revisions = await verifyDocxRevisionPreservation({
    beforeAbs: params.inputAbs,
    afterAbs: params.outputAbs,
  });
  if (revisions.verified && !revisions.ok) {
    await fs.rm(params.outputAbs, { force: true });
    return {
      ok: false,
      code: "revision_preservation_failed",
      error: `${revisions.note ?? "格式修订破坏了原有修订。"}已删除这份副本。`,
      plan,
    };
  }

  return {
    ok: true,
    outputPath: params.outputAbs,
    appliedParagraphs: applied.appliedParagraphs,
    appliedRuns: applied.appliedRuns,
    plan,
    revisions: {
      verified: revisions.verified,
      beforeCount: revisions.beforeCount,
      afterCount: revisions.afterCount,
      ...(revisions.note ? { note: revisions.note } : {}),
    },
    ...(applied.skipped.length > 0
      ? {
          warning: `有 ${applied.skipped.length} 段没改：${applied.skipped[0]?.reason ?? ""}`,
        }
      : {}),
  };
}
