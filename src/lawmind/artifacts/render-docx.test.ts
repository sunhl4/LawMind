import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { renderDocxWithOptions } from "./render-docx.js";

function makeDraft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "docx-task-id",
    title: "Docx Template Test",
    output: "docx",
    templateId: "word/legal-memo-default",
    summary: "summary",
    sections: [{ heading: "结论", body: "正文", citations: ["src-1"] }],
    reviewNotes: [],
    reviewStatus: "approved",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("renderDocxWithOptions", () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-docx-render-"));
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it("renders with built-in contract review variant", async () => {
    const result = await renderDocxWithOptions(makeDraft(), outputDir, {
      templateVariant: "contractReview",
    });
    expect(result.ok).toBe(true);
    expect(result.outputPath).toMatch(/\.docx$/);
  });

  it("renders with uploaded template mapping metadata", async () => {
    const templatePath = path.join(outputDir, "firm-brief-template.docx");
    const templateDoc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("{{case_title}}")] }),
            new Paragraph({ children: [new TextRun("{{case_summary}}")] }),
          ],
        },
      ],
    });
    await fs.writeFile(templatePath, Buffer.from(await Packer.toBuffer(templateDoc)));

    const result = await renderDocxWithOptions(makeDraft(), outputDir, {
      templateVariant: "uploadedMapped",
      uploadedTemplate: {
        id: "upload/firm-brief",
        format: "docx",
        label: "Firm Brief",
        sourcePath: templatePath,
        version: 2,
        enabled: true,
        placeholderMap: {
          case_title: "title",
          case_summary: "summary",
        },
        uploadedAt: new Date().toISOString(),
      },
    });
    expect(result.ok).toBe(true);
    const stat = await fs.stat(result.outputPath!);
    expect(stat.size).toBeGreaterThan(1000);
  });
});
