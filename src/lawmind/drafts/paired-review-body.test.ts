import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  draftHasOpinionScaffoldHeadings,
  preparePairedRedlineBody,
  shouldPreparePairedRedlineBody,
} from "./paired-review-body.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

async function writeMinimalDocx(abs: string, paragraphs: string[]): Promise<void> {
  const zip = new JSZip();
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}</w:body></w:document>`,
  );
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

function opinionDraft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "t-paired-1",
    title: "合同审查意见书",
    output: "docx",
    templateId: "word/memo-default",
    deliverableType: "contract.review",
    summary: "审查钉选合同",
    sections: [
      { heading: "审查结论", body: "先给意见。" },
      { heading: "宏观审查", body: "交易结构待核。" },
      { heading: "微观条款", body: "推荐措辞：甲方所在地人民法院。" },
    ],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    contractEdit: { baselineRelativePath: "uploads/buy.docx", mode: "surgical" },
    ...overrides,
  };
}

describe("paired-review-body", () => {
  it("does not swap on Word revision turns or after a snapshot already exists", () => {
    const draft = opinionDraft();
    expect(draftHasOpinionScaffoldHeadings(draft)).toBe(true);
    expect(shouldPreparePairedRedlineBody({ draft, wordRevisionTurn: true })).toBe(false);
    expect(
      shouldPreparePairedRedlineBody({
        draft: { ...draft, pairedOpinionSections: draft.sections },
      }),
    ).toBe(false);
    expect(
      shouldPreparePairedRedlineBody({
        draft: opinionDraft({
          deliverableType: "contract.general",
          title: "采购合同",
          sections: [{ heading: "正文", body: "甲方应付款。" }],
          contractEdit: { baselineRelativePath: "uploads/buy.docx", mode: "surgical" },
        }),
      }),
    ).toBe(false);
  });

  it("snapshots opinion sections then seeds the Word body", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-paired-body-"));
    dirs.push(ws);
    await writeMinimalDocx(path.join(ws, "uploads/buy.docx"), ["甲方应在十日内付款。"]);
    const { draft, swapped } = await preparePairedRedlineBody({
      workspaceDir: ws,
      draft: opinionDraft(),
    });
    expect(swapped).toBe(true);
    expect(draft.pairedOpinionSections?.some((s) => s.heading === "宏观审查")).toBe(true);
    expect(draftHasOpinionScaffoldHeadings(draft)).toBe(false);
    expect(draft.sections.some((s) => s.body.includes("十日内付款"))).toBe(true);
  });
});
