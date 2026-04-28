/**
 * Artifact Layer — Word 文书渲染
 *
 * 职责：
 *   - 把 ArtifactDraft 渲染为 .docx 文件
 *   - 不包含任何检索或推理逻辑
 *   - 渲染前必须确认 draft.reviewStatus === "approved"
 *
 * 版式：见 docx-legal-typography.ts（律所/合同类常见 Black 体、标题黑体、正文宋体、边距与行距）
 *
 * 依赖：docx (npm)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Document, Packer, Paragraph } from "docx";
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
  paragraphDocumentTitle,
  paragraphHeading1,
  paragraphHeading2,
  paragraphMetaCenter,
  paragraphReviewNoteItem,
} from "./docx-legal-typography.js";

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
};

// ─────────────────────────────────────────────
// Word 渲染器
// ─────────────────────────────────────────────

function buildWordSection(section: ArtifactSection): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  paragraphs.push(paragraphHeading2(section.heading));
  paragraphs.push(...bodyLinesToParagraphs(section.body));

  if (section.citations && section.citations.length > 0) {
    paragraphs.push(paragraphCitationBlock(`【来源引用：${section.citations.join("、")}】`));
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
  if (draft.reviewStatus !== "approved") {
    return {
      ok: false,
      error: `文书未通过审核（当前状态：${draft.reviewStatus}），不能渲染。请律师确认后再执行。`,
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
    const safeTitle = draft.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
    const filename = `${safeTitle}_${draft.taskId.slice(0, 8)}.docx`;
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

  for (const section of draft.sections) {
    allParagraphs.push(...buildWordSection(section));
  }

  if (draft.reviewNotes.length > 0) {
    allParagraphs.push(paragraphHeading1("审阅备注"));
    for (const note of draft.reviewNotes) {
      allParagraphs.push(paragraphReviewNoteItem(note));
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: defaultSectionPageProps(),
        children: allParagraphs,
      },
    ],
  });

  await fs.mkdir(outputDir, { recursive: true });

  const safeTitle = draft.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
  const filename = `${safeTitle}_${draft.taskId.slice(0, 8)}.docx`;
  const outputPath = path.join(outputDir, filename);

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputPath, buffer);

  return { ok: true, outputPath };
}
