/**
 * Artifact Layer — Word 文书渲染
 *
 * 职责：
 *   - 把 ArtifactDraft 渲染为 .docx 文件
 *   - 不包含任何检索或推理逻辑
 *   - 本地出稿：pending / modified / approved 均可；仅 rejected 拒绝
 *
 * 版式：见 docx-legal-typography.ts。备忘录走文首五行；调研报告走学位论文正文版式（无校名、无前置页）。
 *
 * 依赖：docx (npm)
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  Document,
  DocumentGridType,
  Packer,
  PageBreak,
  Paragraph,
  TableOfContents,
  type FileChild,
  type ICommentOptions,
} from "docx";
import { renderProvenanceAsFootnote } from "../drafts/provenance.js";
import {
  formatSectionSeeAlsoLine,
  formatSectionSeeAlsoParts,
  type CitationDisplaySource,
} from "../sources/citation-display.js";
import { fillDocxTemplateWithValues } from "../templates/docx-template-fill.js";
import { buildPlaceholderValueMap } from "../templates/draft-template-values.js";
import type { UploadedTemplateRecord } from "../templates/index.js";
import type { ArtifactDraft, ArtifactSection } from "../types.js";
import { isBusinessReportDeliverable, polishDeliverableDraft } from "./deliverable-deai.js";
import {
  bodyLinesToParagraphs,
  classifyChineseHeadingLevel,
  defaultSectionPageProps,
  deliverableTypeHint,
  docxFaceForVariant,
  formatDraftMetaLine,
  paragraphBodyFirstIndent,
  paragraphCitationBlock,
  paragraphCitationBlockWithLinks,
  paragraphDocumentTitle,
  paragraphHeading1,
  paragraphHeading2WithComment,
  paragraphHeadingAtLevel,
  paragraphMemoClosing,
  paragraphMemoField,
  paragraphMetaCenter,
  pageNumberFooter,
  paragraphReviewNoteItem,
  paragraphTocTitle,
  type DocxFace,
} from "./docx-legal-typography.js";
import { reportBodyChildren, type ThesisFigureCounters } from "./docx-thesis-figures.js";
import { patchReportThesisDocx, reportDocumentStyles } from "./docx-thesis-styles.js";
import { buildDeliverableFilename } from "./matter-word-delivery.js";

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

export type RenderResult = {
  ok: boolean;
  outputPath?: string;
  error?: string;
};

export type RenderDocxOptions = {
  templateVariant?: string;
  uploadedTemplate?: UploadedTemplateRecord;
  /** Research sources for resolving citation ids into lawyer-facing 「参见」 text. */
  sources?: CitationDisplaySource[];
  /** When true, include section provenance as Word comments. */
  includeProvenance?: boolean;
  /** Final basename under outputDir. Default: 标题_YYYYMMDD_01.docx (never task-id). */
  outputFileName?: string;
  /**
   * 出件去 AI 味。默认开启；原 Word 改稿 / 审阅痕迹路径必须关：
   * 只拷贝原件打修订，不应扫全文，也不该改合同用语。
   */
  applyDeliverableDeai?: boolean;
};

function resolveDocxFilename(
  draft: ArtifactDraft,
  outputDir: string,
  outputFileName?: string,
): string {
  const named = outputFileName?.trim();
  if (named) {
    return path.basename(named);
  }
  return buildDeliverableFilename(draft.title || "文书", ".docx", new Date(), {
    dirForUniqueness: outputDir,
  });
}

// ─────────────────────────────────────────────
// Word 渲染器
// ─────────────────────────────────────────────

function buildWordSection(
  section: ArtifactSection,
  sources: CitationDisplaySource[] | undefined,
  includeProvenance: boolean,
  commentState: { nextId: number; comments: ICommentOptions[] },
  face: DocxFace,
  figureState: ThesisFigureCounters | undefined,
): FileChild[] {
  const paragraphs: FileChild[] = [];
  const level = classifyChineseHeadingLevel(section.heading) ?? 1;

  if (includeProvenance && section.provenance?.events.length) {
    const commentText = renderProvenanceAsFootnote(section.provenance);
    const { paragraph, comment } = paragraphHeading2WithComment(
      section.heading,
      commentText,
      commentState.nextId,
      face,
    );
    commentState.nextId += 1;
    commentState.comments.push(comment);
    paragraphs.push(paragraph);
  } else {
    paragraphs.push(paragraphHeadingAtLevel(section.heading, face, level));
  }
  if (face.id === "researchReport" && figureState) {
    paragraphs.push(...reportBodyChildren(section.body, figureState));
  } else {
    paragraphs.push(...bodyLinesToParagraphs(section.body, face));
  }

  const seeAlsoParts = formatSectionSeeAlsoParts(section.citations, sources);
  if (seeAlsoParts) {
    // 有 url 的来源（如 NPC FLK 命中）渲染为可点击超链接；否则保持纯文本行。
    if (seeAlsoParts.some((p) => p.url)) {
      paragraphs.push(paragraphCitationBlockWithLinks(seeAlsoParts, face));
    } else {
      const seeAlso = formatSectionSeeAlsoLine(section.citations, sources);
      if (seeAlso) {
        paragraphs.push(paragraphCitationBlock(seeAlso, face));
      }
    }
  }

  return paragraphs;
}

/**
 * 把 ArtifactDraft 渲染为 Word (.docx) 文件并写入 outputDir。
 *
 * 渲染前会检查 reviewStatus，若未审核通过则直接返回错误。
 */
export async function renderDocx(draft: ArtifactDraft, outputDir: string): Promise<RenderResult> {
  return renderDocxWithOptions(draft, outputDir, {});
}

function resolveSummaryHeading(variant: string): string {
  if (variant === "contractReview") {
    return "一、一句话结论";
  }
  if (variant === "demandLetter") {
    return "一、委托说明";
  }
  if (variant === "researchReport") {
    return "一、调研结论";
  }
  return "一、结论";
}

function summaryToParagraphs(text: string, face: DocxFace): Paragraph[] {
  const t = text.trim();
  if (!t) {
    return [paragraphBodyFirstIndent("（无）", face)];
  }
  return bodyLinesToParagraphs(t, face);
}

function chineseMemoDate(createdAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(createdAt);
  if (!match) {
    return createdAt.slice(0, 10);
  }
  return `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}

function memoSubject(title: string, deliverableType?: ArtifactDraft["deliverableType"]): string {
  const text = title.trim() || "相关事项";
  if (text.startsWith("关于") && (text.includes("备忘录") || text.includes("报告"))) {
    return text;
  }
  if (isBusinessReportDeliverable(deliverableType)) {
    return `关于${text}的报告`;
  }
  return `关于${text}的法律备忘录`;
}

const DISCLAIMER_HEADING = "免责声明";
const DISCLAIMER_BODY_LEGAL =
  "本备忘录系基于客户提供的信息及公开可查询资料进行的初步法律分析，不构成正式法律意见，亦不替代签字律师在尽职调查和审慎核查基础上出具的专业法律意见。相关结论可能因事实补充、法规变化或监管口径调整而需要修正。";
const DISCLAIMER_BODY_BUSINESS =
  "本报告系基于客户提供的信息及公开可查询资料进行的初步分析，不构成正式法律意见，亦不替代签字律师在尽职调查和审慎核查基础上出具的专业法律意见。相关结论可能因事实补充、法规变化或监管口径调整而需要修正。";

function draftAlreadyHasDisclaimer(draft: ArtifactDraft): boolean {
  const blob = [
    draft.summary,
    ...draft.sections.flatMap((section) => [section.heading, section.body]),
  ].join("\n");
  return /免责声明|不构成正式法律意见/.test(blob);
}

const REPORT_DISCLAIMER_LEGAL =
  "本报告系基于客户提供的信息及公开可查询资料进行的初步法律分析，不构成正式法律意见，亦不替代签字律师在尽职调查和审慎核查基础上出具的专业法律意见。相关结论可能因事实补充、法规变化或监管口径调整而需要修正。";

function disclaimerBodyForDraft(draft: ArtifactDraft, asReport = false): string {
  if (isBusinessReportDeliverable(draft.deliverableType)) {
    return DISCLAIMER_BODY_BUSINESS;
  }
  return asReport ? REPORT_DISCLAIMER_LEGAL : DISCLAIMER_BODY_LEGAL;
}

function draftHasConclusionSection(draft: ArtifactDraft): boolean {
  return draft.sections.some((section) => /结论|意见/.test(section.heading));
}

function pushReportTocHeading(
  entries: Array<{ title: string; level: number }>,
  text: string,
): void {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "目录") {
    return;
  }
  const chinese = classifyChineseHeadingLevel(trimmed) ?? 1;
  const level = chinese + 1;
  if (level <= 3) {
    entries.push({ title: trimmed, level });
  }
}

function collectReportTocEntries(
  draft: ArtifactDraft,
  summaryHeading: string,
): Array<{ title: string; level: number }> {
  const entries: Array<{ title: string; level: number }> = [];
  if (draft.title.trim()) {
    entries.push({ title: draft.title.trim(), level: 1 });
  }
  if (draft.summary.trim() && !draftHasConclusionSection(draft)) {
    pushReportTocHeading(entries, summaryHeading);
  }
  for (const section of draft.sections) {
    pushReportTocHeading(entries, section.heading);
    for (const raw of section.body.split("\n")) {
      const line = raw.trim();
      if (classifyChineseHeadingLevel(line)) {
        pushReportTocHeading(entries, line);
      }
    }
  }
  if (!draftAlreadyHasDisclaimer(draft)) {
    pushReportTocHeading(entries, DISCLAIMER_HEADING);
  }
  return entries;
}

export async function renderDocxWithOptions(
  draft: ArtifactDraft,
  outputDir: string,
  options: RenderDocxOptions,
): Promise<RenderResult> {
  if (draft.reviewStatus === "rejected") {
    return {
      ok: false,
      error: `文书已驳回（当前状态：${draft.reviewStatus}），不能渲染。`,
    };
  }

  // 新建交件默认去 AI 味；原 Word 改稿（contractEdit / 调用方显式关闭）跳过。
  const shouldDeai = options.applyDeliverableDeai !== false && draft.contractEdit === undefined;
  if (shouldDeai) {
    draft = polishDeliverableDraft(draft).draft;
  }

  if (options.templateVariant === "uploadedMapped" && options.uploadedTemplate?.format === "docx") {
    const up = options.uploadedTemplate;
    try {
      await fs.access(up.sourcePath);
    } catch {
      return {
        ok: false,
        error: "上传的 Word 模板已不再支持。请改用内置模板出稿。",
      };
    }
    const values = buildPlaceholderValueMap(draft, up.placeholderMap);
    const filename = resolveDocxFilename(draft, outputDir, options.outputFileName);
    const outputPath = path.join(outputDir, filename);
    try {
      await fillDocxTemplateWithValues({ sourcePath: up.sourcePath, outputPath, values });
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    return { ok: true, outputPath };
  }

  const variant = options.templateVariant ?? "legalMemo";
  const face = docxFaceForVariant(variant);
  const summaryHeading = resolveSummaryHeading(variant);
  const researchMemo = face.id === "researchMemo";
  const researchReport = face.id === "researchReport";

  const commentState = { nextId: 1, comments: [] as ICommentOptions[] };
  const figureState: ThesisFigureCounters = { figure: 0, table: 0 };
  const allParagraphs: FileChild[] = [];
  const appendSection = (section: ArtifactSection) => {
    allParagraphs.push(
      ...buildWordSection(
        section,
        options.sources,
        options.includeProvenance ?? false,
        commentState,
        face,
        researchReport ? figureState : undefined,
      ),
    );
  };

  if (researchReport || researchMemo) {
    if (researchMemo) {
      const fromLine = draft.audience?.trim() ? `致：${draft.audience.trim()}` : "致：";
      allParagraphs.push(
        paragraphMemoField(fromLine, face),
        paragraphMemoField("自：", face),
        paragraphMemoField(`日期：${chineseMemoDate(draft.createdAt)}`, face),
        paragraphMemoField(`事由：${memoSubject(draft.title, draft.deliverableType)}`, face),
        paragraphMemoField("保密：律师工作秘密，非经许可不得对外披露", face),
      );
    }
    allParagraphs.push(paragraphDocumentTitle(draft.title, face));
    if (researchReport) {
      allParagraphs.push(
        paragraphTocTitle("目录", face),
        new TableOfContents("目录", {
          headingStyleRange: "1-3",
          hyperlink: true,
          useAppliedParagraphOutlineLevel: true,
          cachedEntries: collectReportTocEntries(draft, summaryHeading),
        }),
        new Paragraph({ children: [new PageBreak()] }),
      );
    }
    // 草稿摘要仅在尚无「结论」栏目时写入，避免与正文重复、也不写 AI 工作底稿栏目。
    if (draft.summary.trim() && !draftHasConclusionSection(draft)) {
      allParagraphs.push(paragraphHeading1(summaryHeading, face));
      allParagraphs.push(...summaryToParagraphs(draft.summary, face));
    }
    for (const section of draft.sections) {
      appendSection(section);
    }
    if (!draftAlreadyHasDisclaimer(draft)) {
      allParagraphs.push(paragraphHeading1(DISCLAIMER_HEADING, face));
      allParagraphs.push(
        ...bodyLinesToParagraphs(disclaimerBodyForDraft(draft, researchReport), face),
      );
    }
    if (researchMemo) {
      allParagraphs.push(paragraphMemoClosing(chineseMemoDate(draft.createdAt), face));
    }
  } else {
    allParagraphs.push(
      paragraphDocumentTitle(draft.title, face),
      paragraphMetaCenter(deliverableTypeHint(draft.deliverableType), face),
      paragraphMetaCenter(formatDraftMetaLine(draft.createdAt, draft.matterId), face),
      paragraphHeading1(summaryHeading, face),
      ...summaryToParagraphs(draft.summary, face),
    );
    for (const section of draft.sections) {
      appendSection(section);
    }
  }

  // 审阅备注是产品内部痕迹，不写入对外备忘录或报告。
  if (!researchMemo && !researchReport && draft.reviewNotes.length > 0) {
    allParagraphs.push(paragraphHeading1("审阅备注", face));
    for (const note of draft.reviewNotes) {
      allParagraphs.push(paragraphReviewNoteItem(note, face));
    }
  }

  const doc = new Document({
    ...(commentState.comments.length > 0 ? { comments: { children: commentState.comments } } : {}),
    ...(researchReport ? { styles: reportDocumentStyles(), features: { updateFields: true } } : {}),
    sections: [
      {
        properties: {
          ...defaultSectionPageProps(face),
          ...(researchReport
            ? { grid: { type: DocumentGridType.LINES, linePitch: 312, charSpace: 0 } }
            : {}),
        },
        ...(face.showPageNumber ? { footers: { default: pageNumberFooter(face) } } : {}),
        children: allParagraphs,
      },
    ],
  });

  await fs.mkdir(outputDir, { recursive: true });

  const filename = resolveDocxFilename(draft, outputDir, options.outputFileName);
  const outputPath = path.join(outputDir, filename);

  const packed = await Packer.toBuffer(doc);
  const buffer = researchReport ? await patchReportThesisDocx(packed) : packed;
  await fs.writeFile(outputPath, buffer);

  return { ok: true, outputPath };
}
