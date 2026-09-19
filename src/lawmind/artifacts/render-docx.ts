/**
 * Artifact Layer — Word 文书渲染
 *
 * 职责：
 *   - 把 ArtifactDraft 渲染为 .docx 文件
 *   - 不包含任何检索或推理逻辑
 *   - 本地出稿：pending / modified / approved 均可；仅 rejected 拒绝
 *
 * 版式：见 docx-legal-typography.ts（律所/合同类常见 Black 体、标题黑体、正文宋体、边距与行距）
 *
 * 依赖：docx (npm)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Document, Packer, Paragraph, type ICommentOptions } from "docx";
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
import {
  bodyLinesToParagraphs,
  defaultSectionPageProps,
  deliverableTypeHint,
  formatDraftMetaLine,
  paragraphBodyFirstIndent,
  paragraphCitationBlock,
  paragraphCitationBlockWithLinks,
  paragraphDocumentTitle,
  paragraphHeading1,
  paragraphHeading2,
  paragraphHeading2WithComment,
  paragraphMetaCenter,
  paragraphReviewNoteItem,
} from "./docx-legal-typography.js";
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
): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  if (includeProvenance && section.provenance?.events.length) {
    const commentText = renderProvenanceAsFootnote(section.provenance);
    const { paragraph, comment } = paragraphHeading2WithComment(
      section.heading,
      commentText,
      commentState.nextId,
    );
    commentState.nextId += 1;
    commentState.comments.push(comment);
    paragraphs.push(paragraph);
  } else {
    paragraphs.push(paragraphHeading2(section.heading));
  }
  paragraphs.push(...bodyLinesToParagraphs(section.body));

  const seeAlsoParts = formatSectionSeeAlsoParts(section.citations, sources);
  if (seeAlsoParts) {
    // 有 url 的来源（如 NPC FLK 命中）渲染为可点击超链接；否则保持纯文本行。
    if (seeAlsoParts.some((p) => p.url)) {
      paragraphs.push(paragraphCitationBlockWithLinks(seeAlsoParts));
    } else {
      const seeAlso = formatSectionSeeAlsoLine(section.citations, sources);
      if (seeAlso) {
        paragraphs.push(paragraphCitationBlock(seeAlso));
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
    return "审查结论";
  }
  if (variant === "demandLetter") {
    return "核心主张";
  }
  return "摘要";
}

function summaryToParagraphs(text: string): Paragraph[] {
  const t = text.trim();
  if (!t) {
    return [paragraphBodyFirstIndent("（无）")];
  }
  return bodyLinesToParagraphs(t);
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

  if (options.templateVariant === "uploadedMapped" && options.uploadedTemplate?.format === "docx") {
    const up = options.uploadedTemplate;
    try {
      await fs.access(up.sourcePath);
    } catch {
      return {
        ok: false,
        error: "上传的 Word 模板文件不存在或不可读。请在设置中重新登记或恢复模板文件。",
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
  const summaryHeading = resolveSummaryHeading(variant);

  const allParagraphs: Paragraph[] = [
    paragraphDocumentTitle(draft.title),
    paragraphMetaCenter(deliverableTypeHint(draft.deliverableType)),
    paragraphMetaCenter(formatDraftMetaLine(draft.createdAt, draft.matterId)),
    paragraphHeading1(summaryHeading),
    ...summaryToParagraphs(draft.summary),
  ];
  const commentState = { nextId: 1, comments: [] as ICommentOptions[] };

  for (const section of draft.sections) {
    allParagraphs.push(
      ...buildWordSection(
        section,
        options.sources,
        options.includeProvenance ?? false,
        commentState,
      ),
    );
  }

  if (draft.reviewNotes.length > 0) {
    allParagraphs.push(paragraphHeading1("审阅备注"));
    for (const note of draft.reviewNotes) {
      allParagraphs.push(paragraphReviewNoteItem(note));
    }
  }

  const doc = new Document({
    ...(commentState.comments.length > 0 ? { comments: { children: commentState.comments } } : {}),
    sections: [
      {
        properties: defaultSectionPageProps(),
        children: allParagraphs,
      },
    ],
  });

  await fs.mkdir(outputDir, { recursive: true });

  const filename = resolveDocxFilename(draft, outputDir, options.outputFileName);
  const outputPath = path.join(outputDir, filename);

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputPath, buffer);

  return { ok: true, outputPath };
}
