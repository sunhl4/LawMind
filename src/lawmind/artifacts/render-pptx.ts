/**
 * Artifact Layer — PowerPoint 汇报渲染
 *
 * 把 ArtifactDraft 渲染为 .pptx（每节一章幻灯片 + 标题页）。
 */

import fs from "node:fs/promises";
import path from "node:path";
import PptxGenJS from "pptxgenjs";
import type { UploadedTemplateRecord } from "../templates/index.js";
import type { ArtifactDraft, ArtifactSection } from "../types.js";
import type { RenderResult } from "./render-docx.js";

type PptxPresentation = InstanceType<typeof PptxGenJS>;

export type RenderPptxOptions = {
  templateVariant?: string;
  uploadedTemplate?: UploadedTemplateRecord;
};

function addSectionSlide(pptx: PptxPresentation, section: ArtifactSection): void {
  const slide = pptx.addSlide();
  slide.addText(section.heading, {
    x: 0.5,
    y: 0.35,
    w: 9,
    h: 0.75,
    fontSize: 24,
    bold: true,
    color: "1a1a1a",
  });

  const body = section.body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");

  slide.addText(body || "（无正文）", {
    x: 0.5,
    y: 1.2,
    w: 9,
    h: 5.4,
    fontSize: 13,
    color: "333333",
    valign: "top",
    wrap: true,
  });

  if (section.citations && section.citations.length > 0) {
    slide.addText(`来源：${section.citations.join("、")}`, {
      x: 0.5,
      y: 6.75,
      w: 9,
      h: 0.55,
      fontSize: 10,
      italic: true,
      color: "666666",
    });
  }
}

/**
 * 把 ArtifactDraft 渲染为 PPT (.pptx) 并写入 outputDir。
 * 渲染前会检查 reviewStatus。
 */
export async function renderPptx(draft: ArtifactDraft, outputDir: string): Promise<RenderResult> {
  return renderPptxWithOptions(draft, outputDir, {});
}

function resolveDeckStyle(variant: string): {
  accent: string;
  subtitle: string;
  footerLabel: string;
} {
  if (variant === "hearingStrategy") {
    return {
      accent: "3b4cca",
      subtitle: "Hearing Strategy",
      footerLabel: "Template: Hearing Strategy",
    };
  }
  if (variant === "evidenceTimeline") {
    return {
      accent: "7a4f15",
      subtitle: "Evidence Timeline",
      footerLabel: "Template: Evidence Timeline",
    };
  }
  if (variant === "uploadedMapped") {
    return {
      accent: "1f7a6e",
      subtitle: "Uploaded Template Mapping",
      footerLabel: "Template: Uploaded",
    };
  }
  return {
    accent: "1a1a1a",
    subtitle: "Client Brief",
    footerLabel: "Template: Client Brief",
  };
}

function uploadedTemplateNotes(uploaded: UploadedTemplateRecord | undefined): string {
  if (!uploaded) {
    return "";
  }
  const mappings = Object.entries(uploaded.placeholderMap).map(
    ([placeholder, source]) => `{{${placeholder}}} -> ${source}`,
  );
  if (mappings.length === 0) {
    return `Uploaded template: ${uploaded.label} v${uploaded.version}`;
  }
  return [`Uploaded template: ${uploaded.label} v${uploaded.version}`, ...mappings].join("\n");
}

export async function renderPptxWithOptions(
  draft: ArtifactDraft,
  outputDir: string,
  options: RenderPptxOptions,
): Promise<RenderResult> {
  if (draft.reviewStatus !== "approved") {
    return {
      ok: false,
      error: `文书未通过审核（当前状态：${draft.reviewStatus}），不能渲染。请律师确认后再执行。`,
    };
  }

  const style = resolveDeckStyle(options.templateVariant ?? "clientBrief");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "LawMind";

  const titleSlide = pptx.addSlide();
  titleSlide.addText(draft.title, {
    x: 0.6,
    y: 1.4,
    w: 8.8,
    h: 1.2,
    fontSize: 32,
    bold: true,
    color: style.accent,
  });
  titleSlide.addText(style.subtitle, {
    x: 0.6,
    y: 0.9,
    w: 8.8,
    h: 0.4,
    fontSize: 14,
    color: "666666",
  });
  if (draft.summary.trim()) {
    titleSlide.addText(draft.summary, {
      x: 0.6,
      y: 2.85,
      w: 8.8,
      h: 2.2,
      fontSize: 14,
      color: "444444",
      valign: "top",
      wrap: true,
    });
  }
  if (draft.audience) {
    titleSlide.addText(`受众：${draft.audience}`, {
      x: 0.6,
      y: 6.85,
      w: 8.8,
      h: 0.45,
      fontSize: 12,
      color: "666666",
    });
  }
  const uploadedNotes = uploadedTemplateNotes(options.uploadedTemplate);
  if (uploadedNotes) {
    titleSlide.addText(uploadedNotes, {
      x: 6.1,
      y: 5.6,
      w: 3.2,
      h: 1.5,
      fontSize: 10,
      color: "444444",
      valign: "top",
      wrap: true,
    });
  }
  titleSlide.addText(style.footerLabel, {
    x: 0.6,
    y: 7.1,
    w: 4.5,
    h: 0.3,
    fontSize: 10,
    color: "888888",
  });

  for (const section of draft.sections) {
    addSectionSlide(pptx, section);
  }

  if (draft.reviewNotes.length > 0) {
    const slide = pptx.addSlide();
    slide.addText("审阅备注", {
      x: 0.5,
      y: 0.35,
      w: 9,
      h: 0.65,
      fontSize: 22,
      bold: true,
      color: "1a1a1a",
    });
    slide.addText(draft.reviewNotes.map((n) => `• ${n}`).join("\n"), {
      x: 0.5,
      y: 1.1,
      w: 9,
      h: 5.8,
      fontSize: 12,
      italic: true,
      color: "333333",
      valign: "top",
      wrap: true,
    });
  }

  await fs.mkdir(outputDir, { recursive: true });

  const safeTitle = draft.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
  const filename = `${safeTitle}_${draft.taskId.slice(0, 8)}.pptx`;
  const outputPath = path.join(outputDir, filename);

  await pptx.writeFile({ fileName: outputPath });

  return { ok: true, outputPath };
}
