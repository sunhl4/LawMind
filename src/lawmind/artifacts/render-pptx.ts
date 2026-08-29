/**
 * Artifact Layer — PowerPoint 汇报渲染
 *
 * Structured layouts (agenda / bullets / two-column / matrix / checklist)
 * instead of a single free-floating text box per section.
 */

import fs from "node:fs/promises";
import path from "node:path";
import PptxGenJS from "pptxgenjs";
import {
  formatSectionSeeAlsoLine,
  type CitationDisplaySource,
} from "../sources/citation-display.js";
import type { UploadedTemplateRecord } from "../templates/index.js";
import type { ArtifactDraft, ArtifactSection } from "../types.js";
import { parseSectionToSlideContent, type ParsedSlideContent } from "./pptx-slide-layouts.js";
import type { RenderResult } from "./render-docx.js";

type PptxTextOpts = Record<string, string | number | boolean | undefined>;
type PptxSlide = {
  addText: (text: string | unknown[], options?: PptxTextOpts) => unknown;
  addShape?: (shape: unknown, options?: Record<string, unknown>) => unknown;
};
type PptxPresentation = {
  layout: string;
  author: string;
  addSlide: () => PptxSlide;
  writeFile: (opts: { fileName: string }) => Promise<string | void>;
};
type PptxConstructor = new () => PptxPresentation;

export type RenderPptxOptions = {
  templateVariant?: string;
  uploadedTemplate?: UploadedTemplateRecord;
  sources?: CitationDisplaySource[];
};

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
  if (variant === "trainingCle") {
    return {
      accent: "0f3d5c",
      subtitle: "Compliance / CLE Training",
      footerLabel: "Template: Training CLE",
    };
  }
  if (variant === "crossborderMatrix") {
    return {
      accent: "1a4a6b",
      subtitle: "Cross-border Jurisdiction Briefing",
      footerLabel: "Template: Cross-border Matrix",
    };
  }
  if (variant === "internalKnowledge") {
    return {
      accent: "2c3e50",
      subtitle: "Internal Knowledge Share",
      footerLabel: "Template: Internal Knowledge",
    };
  }
  if (variant === "caseClinic") {
    return {
      accent: "4a3728",
      subtitle: "Case Clinic (Redacted)",
      footerLabel: "Template: Case Clinic",
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

function addHeading(slide: PptxSlide, text: string, accent: string): void {
  slide.addText(text, {
    x: 0.5,
    y: 0.3,
    w: 9,
    h: 0.65,
    fontSize: 22,
    bold: true,
    color: accent,
  });
}

function addFooter(slide: PptxSlide, footer?: string): void {
  if (!footer) {
    return;
  }
  slide.addText(footer, {
    x: 0.5,
    y: 6.85,
    w: 9,
    h: 0.45,
    fontSize: 10,
    italic: true,
    color: "666666",
  });
}

function bulletBlock(
  items: string[],
  opts: { x: number; y: number; w: number; h: number; fontSize?: number },
): unknown[] {
  return items.map((t, i) => ({
    text: `${i + 1}. ${t}`,
    options: { breakLine: true, fontSize: opts.fontSize ?? 14, color: "333333" },
  }));
}

function renderStructuredSlide(
  pptx: PptxPresentation,
  content: ParsedSlideContent,
  accent: string,
): void {
  const slide = pptx.addSlide();
  addHeading(slide, content.heading, accent);

  if (content.layout === "matrix" && content.matrix && content.matrix.length > 0) {
    const cols = content.matrix[0]?.length ?? 1;
    const colW = Math.min(9 / cols, 2.2);
    content.matrix.slice(0, 8).forEach((row, ri) => {
      row.slice(0, cols).forEach((cell, ci) => {
        slide.addText(cell.slice(0, 80), {
          x: 0.45 + ci * colW,
          y: 1.15 + ri * 0.7,
          w: colW - 0.08,
          h: 0.65,
          fontSize: ri === 0 ? 11 : 12,
          bold: ri === 0,
          color: ri === 0 ? accent : "333333",
          valign: "middle",
        });
      });
    });
    addFooter(slide, content.footer);
    return;
  }

  if (content.layout === "twoColumn" && content.left && content.right) {
    slide.addText(bulletBlock(content.left, { x: 0.5, y: 1.15, w: 4.4, h: 5.2 }), {
      x: 0.5,
      y: 1.15,
      w: 4.4,
      h: 5.2,
      valign: "top",
    });
    slide.addText(bulletBlock(content.right, { x: 5.2, y: 1.15, w: 4.4, h: 5.2 }), {
      x: 5.2,
      y: 1.15,
      w: 4.4,
      h: 5.2,
      valign: "top",
    });
    addFooter(slide, content.footer);
    return;
  }

  if (
    content.layout === "agenda" ||
    content.layout === "checklist" ||
    content.layout === "bullets"
  ) {
    const prefix = content.layout === "checklist" ? "☐ " : content.layout === "agenda" ? "" : "• ";
    const items = content.bullets.map((t, i) => ({
      text: content.layout === "agenda" ? `${i + 1}. ${t}` : `${prefix}${t}`,
      options: {
        breakLine: true,
        fontSize: 16,
        color: "333333",
        bold: content.layout === "agenda",
      },
    }));
    slide.addText(items, {
      x: 0.7,
      y: 1.2,
      w: 8.6,
      h: 5.3,
      valign: "top",
    });
    addFooter(slide, content.footer);
    return;
  }

  if (content.layout === "quote") {
    const quote = content.bullets.join("\n") || "（无正文）";
    slide.addText(quote, {
      x: 1,
      y: 2,
      w: 8,
      h: 3.5,
      fontSize: 18,
      color: "222222",
      italic: true,
      valign: "middle",
      align: "center",
    });
    addFooter(slide, content.footer);
    return;
  }

  // titleBody fallback
  slide.addText(content.bullets.join("\n\n") || "（无正文）", {
    x: 0.5,
    y: 1.2,
    w: 9,
    h: 5.3,
    fontSize: 14,
    color: "333333",
    valign: "top",
    wrap: true,
  });
  addFooter(slide, content.footer);
}

function addSectionSlide(
  pptx: PptxPresentation,
  section: ArtifactSection,
  accent: string,
  sources?: CitationDisplaySource[],
): void {
  const seeAlso = formatSectionSeeAlsoLine(section.citations, sources);
  const content = parseSectionToSlideContent(section.heading, section.body, seeAlso || undefined);
  renderStructuredSlide(pptx, content, accent);
}

export async function renderPptx(draft: ArtifactDraft, outputDir: string): Promise<RenderResult> {
  return renderPptxWithOptions(draft, outputDir, {});
}

export async function renderPptxWithOptions(
  draft: ArtifactDraft,
  outputDir: string,
  options: RenderPptxOptions,
): Promise<RenderResult> {
  if (draft.reviewStatus === "rejected") {
    return {
      ok: false,
      error: `文书已驳回（当前状态：${draft.reviewStatus}），不能渲染。`,
    };
  }

  const style = resolveDeckStyle(options.templateVariant ?? "clientBrief");
  const pptx = new (PptxGenJS as unknown as PptxConstructor)();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "LawMind";

  const titleSlide = pptx.addSlide();
  titleSlide.addText(style.subtitle, {
    x: 0.6,
    y: 0.9,
    w: 8.8,
    h: 0.4,
    fontSize: 14,
    color: "666666",
  });
  titleSlide.addText(draft.title, {
    x: 0.6,
    y: 1.4,
    w: 8.8,
    h: 1.2,
    fontSize: 32,
    bold: true,
    color: style.accent,
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
    addSectionSlide(pptx, section, style.accent, options.sources);
  }

  if (draft.reviewNotes.length > 0) {
    renderStructuredSlide(
      pptx,
      {
        layout: "bullets",
        heading: "审阅备注",
        bullets: draft.reviewNotes.map((n) => n),
      },
      style.accent,
    );
  }

  await fs.mkdir(outputDir, { recursive: true });

  const safeTitle = draft.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
  const filename = `${safeTitle}_${draft.taskId.slice(0, 8)}.pptx`;
  const outputPath = path.join(outputDir, filename);

  await pptx.writeFile({ fileName: outputPath });

  return { ok: true, outputPath };
}
