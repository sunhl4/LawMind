/**
 * Artifact Layer — Word 文书渲染
 *
 * 职责：
 *   - 把 ArtifactDraft 渲染为 .docx 文件
 *   - 不包含任何检索或推理逻辑
 *   - 渲染前必须确认 draft.reviewStatus === "approved"
 *
 * 扩展方式：
 *   - 新文书类型：在 templates/ 目录增加 Markdown 模板，
 *     实现对应 TemplateRenderer，注册到 RENDERER_MAP 即可。
 *   - PPT 渲染：见 render-pptx.ts（引擎按 draft.output 分发）。
 *
 * 依赖：
 *   - docx  (npm i docx)  — Word 生成
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import type { ArtifactDraft, ArtifactSection } from "../types.js";

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

export type RenderResult = {
  ok: boolean;
  outputPath?: string;
  error?: string;
};

// ─────────────────────────────────────────────
// Word 渲染器
// ─────────────────────────────────────────────

function buildWordSection(section: ArtifactSection): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // 章节标题
  paragraphs.push(
    new Paragraph({
      text: section.heading,
      heading: HeadingLevel.HEADING_2,
    }),
  );

  // 正文（简单按换行拆分，后续可扩展 Markdown 解析）
  for (const line of section.body.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: line.trim() })],
      }),
    );
  }

  // 引用来源标注
  if (section.citations && section.citations.length > 0) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `【来源：${section.citations.join("、")}】`,
            italics: true,
            size: 18,
          }),
        ],
      }),
    );
  }

  return paragraphs;
}

/**
 * 把 ArtifactDraft 渲染为 Word (.docx) 文件并写入 outputDir。
 *
 * 渲染前会检查 reviewStatus，若未审核通过则直接返回错误。
 */
export async function renderDocx(draft: ArtifactDraft, outputDir: string): Promise<RenderResult> {
  if (draft.reviewStatus !== "approved") {
    return {
      ok: false,
      error: `文书未通过审核（当前状态：${draft.reviewStatus}），不能渲染。请律师确认后再执行。`,
    };
  }

  const allParagraphs: Paragraph[] = [
    // 文书标题
    new Paragraph({
      text: draft.title,
      heading: HeadingLevel.TITLE,
    }),
    // 执行摘要
    new Paragraph({
      text: "摘要",
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      children: [new TextRun({ text: draft.summary })],
    }),
  ];

  // 正文章节
  for (const section of draft.sections) {
    allParagraphs.push(...buildWordSection(section));
  }

  // 审阅备注（如有）
  if (draft.reviewNotes.length > 0) {
    allParagraphs.push(new Paragraph({ text: "审阅备注", heading: HeadingLevel.HEADING_1 }));
    for (const note of draft.reviewNotes) {
      allParagraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${note}`, italics: true })],
        }),
      );
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children: allParagraphs }],
  });

  await fs.mkdir(outputDir, { recursive: true });

  const safeTitle = draft.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
  const filename = `${safeTitle}_${draft.taskId.slice(0, 8)}.docx`;
  const outputPath = path.join(outputDir, filename);

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputPath, buffer);

  return { ok: true, outputPath };
}
