import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { afterEach, describe, expect, it } from "vitest";
import { renderDocxWithOptions } from "../artifacts/render-docx.js";
import type { ArtifactDraft } from "../types.js";
import {
  complaintMasterHint,
  preferComplaintMasterTemplate,
  resolveComplaintMasterTemplate,
  resolveComplaintMasterUploaded,
} from "./complaint-master.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("complaint-master", () => {
  it("hints linear columns when no Word master exists", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-complaint-"));
    dirs.push(ws);
    expect(resolveComplaintMasterTemplate(ws)).toBeUndefined();
    expect(complaintMasterHint(ws)).toContain("线性栏目");
  });

  it("seeds an OOXML skeleton when rendering a 起诉状 without a workspace master", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-complaint-"));
    dirs.push(ws);
    const current = {
      requestedId: "word/legal-memo-default",
      resolvedId: "word/legal-memo-default",
      format: "docx" as const,
      variant: "legalMemo",
      source: "built-in" as const,
    };
    const preferred = await preferComplaintMasterTemplate(ws, current, {
      output: "docx",
      deliverableType: "litigation.complaint",
    });
    expect(preferred.source).toBe("uploaded");
    expect(resolveComplaintMasterTemplate(ws)).toBe("templates/word/complaint-master.docx");
  });

  it("uses a workspace Word master when present", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-complaint-"));
    dirs.push(ws);
    const rel = path.join(ws, "templates", "word");
    fs.mkdirSync(rel, { recursive: true });
    fs.writeFileSync(path.join(rel, "complaint-master.docx"), "fake");
    expect(resolveComplaintMasterTemplate(ws)).toBe("templates/word/complaint-master.docx");
    expect(complaintMasterHint(ws)).toContain("complaint-master.docx");
  });

  it("does not treat a non-OOXML placeholder as a clone source", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-complaint-"));
    dirs.push(ws);
    const rel = path.join(ws, "templates", "word");
    fs.mkdirSync(rel, { recursive: true });
    fs.writeFileSync(path.join(rel, "complaint-master.docx"), "fake");
    expect(await resolveComplaintMasterUploaded(ws)).toBeUndefined();
  });

  it("clones a real workspace Word master when rendering a 起诉状", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-complaint-"));
    dirs.push(ws);
    const rel = path.join(ws, "templates", "word");
    fs.mkdirSync(rel, { recursive: true });
    const templateDoc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("民事起诉状")] }),
            new Paragraph({ children: [new TextRun("当事人：{{title}}")] }),
          ],
        },
      ],
    });
    fs.writeFileSync(
      path.join(rel, "complaint-master.docx"),
      Buffer.from(await Packer.toBuffer(templateDoc)),
    );
    const uploaded = await resolveComplaintMasterUploaded(ws);
    expect(uploaded?.id).toBe("complaint-master");
    const current = {
      requestedId: "word/legal-memo-default",
      resolvedId: "word/legal-memo-default",
      format: "docx" as const,
      variant: "legalMemo",
      source: "built-in" as const,
    };
    const preferred = await preferComplaintMasterTemplate(ws, current, {
      output: "docx",
      deliverableType: "litigation.complaint",
    });
    expect(preferred.source).toBe("uploaded");
    expect(preferred.variant).toBe("uploadedMapped");
    const outDir = path.join(ws, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const draft: ArtifactDraft = {
      taskId: "complaint-render",
      title: "张三诉李四",
      output: "docx",
      templateId: "word/legal-memo-default",
      deliverableType: "litigation.complaint",
      summary: "summary",
      sections: [{ heading: "诉讼请求", body: "请求判令…", citations: [] }],
      reviewNotes: [],
      reviewStatus: "approved",
      createdAt: new Date().toISOString(),
    };
    const rendered = await renderDocxWithOptions(draft, outDir, {
      templateVariant: preferred.variant,
      uploadedTemplate: preferred.uploaded,
    });
    expect(rendered.ok).toBe(true);
    expect(rendered.outputPath).toMatch(/\.docx$/);
  });
});
