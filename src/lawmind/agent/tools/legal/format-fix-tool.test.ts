import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { fixDocumentFormat } from "./format-fix-tool.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

type ParaSpec = {
  text: string;
  font: string;
  halfPt: number;
  line?: number;
  inset?: { id: string; author: string; date: string };
};

function para(spec: ParaSpec): string {
  const font = `<w:rFonts w:eastAsia="${spec.font}" w:ascii="${spec.font}"/>`;
  const size = `<w:sz w:val="${spec.halfPt}"/><w:szCs w:val="${spec.halfPt}"/>`;
  const rPr = `<w:rPr>${font}${size}</w:rPr>`;
  const spacing = spec.line != null ? `<w:spacing w:line="${spec.line}" w:lineRule="exact"/>` : "";
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${spec.text}</w:t></w:r>`;
  const body = spec.inset
    ? `<w:ins w:id="${spec.inset.id}" w:author="${spec.inset.author}" w:date="${spec.inset.date}">${run}</w:ins>`
    : run;
  return `<w:p>${spacing ? `<w:pPr>${spacing}</w:pPr>` : ""}${body}</w:p>`;
}

async function writeDocx(dir: string, name: string, paragraphs: ParaSpec[]): Promise<string> {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${paragraphs.map(para).join("")}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
    `</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  zip.file("word/styles.xml", `<?xml version="1.0"?><w:styles xmlns:w="${W}"></w:styles>`);
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));
  return abs;
}

describe("fix_document_format", () => {
  it("writes a sibling copy, follows the original, and reports the revision ledger", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fmt-fix-tool-"));
    await writeDocx(ws, "回稿.docx", [
      {
        text: "本合同自双方签字之日起生效，任何变更须书面确认。",
        font: "SimSun",
        halfPt: 24,
        line: 360,
        inset: { id: "11", author: "对方律师", date: "2026-10-01T00:00:00Z" },
      },
      {
        text: "乙方应在收到货物后十日内完成验收并书面通知甲方。",
        font: "SimSun",
        halfPt: 24,
        line: 360,
      },
      {
        text: "甲方应于验收合格后三十日内支付价款，逾期按日万分之五计息。",
        font: "FangSong_GB2312",
        halfPt: 32,
      },
    ]);

    const result = await fixDocumentFormat.execute(
      { file_path: "回稿.docx", lawmind_paragraphs: [2] },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      outputPath: string;
      appliedParagraphs: number;
      revisions: { verified: boolean; beforeCount: number; afterCount: number };
      noteZh: string;
      skippedKinds: string[];
    };
    expect(data.outputPath).toBe("回稿_格式修订.docx");
    expect(data.appliedParagraphs).toBe(1);
    expect(data.revisions.verified).toBe(true);
    expect(data.revisions.afterCount).toBeGreaterThan(data.revisions.beforeCount);
    expect(data.noteZh).toContain("原文件未改");
    expect(data.skippedKinds.join("")).toContain("页边距");
    expect(fs.existsSync(path.join(ws, "回稿_格式修订.docx"))).toBe(true);
  });

  it("refuses to fix into the original or a non-docx", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fmt-fix-tool-"));
    await writeDocx(ws, "回稿.docx", [
      { text: "本合同自双方签字之日起生效，任何变更须书面确认。", font: "SimSun", halfPt: 24 },
    ]);

    const same = await fixDocumentFormat.execute(
      { file_path: "回稿.docx", output_path: "回稿.docx", lawmind_paragraphs: [0] },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(same.ok).toBe(false);
    expect(same.error).toContain("不能覆盖原文件");

    const bad = await fixDocumentFormat.execute(
      { file_path: "回稿.docx", output_path: "回稿.pdf" },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(bad.ok).toBe(false);
  });

  it("does nothing when the lawyer did not point at any LawMind paragraph", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fmt-fix-tool-"));
    await writeDocx(ws, "回稿.docx", [
      { text: "本合同自双方签字之日起生效，任何变更须书面确认。", font: "SimSun", halfPt: 24 },
    ]);
    const result = await fixDocumentFormat.execute(
      { file_path: "回稿.docx" },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不需要改");
    expect(fs.existsSync(path.join(ws, "回稿_格式修订.docx"))).toBe(false);
  });
});
