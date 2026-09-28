import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { persistDraft } from "./index.js";
import { writeRedlineProposal, type RedlineProposal } from "./redline-proposal.js";
import {
  composeWordSurface,
  extractDocxParagraphsFromXml,
  loadWordSurface,
  paintPendingRevisions,
} from "./word-surface.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("paintPendingRevisions", () => {
  it("marks the changed span and leaves the rest", () => {
    const segments = paintPendingRevisions("甲方应于十日内付款。", [
      { hunkId: "h1", before: "十日", after: "五日", rationale: "缩短账期" },
    ]);
    expect(segments).toEqual([
      { kind: "text", text: "甲方应于" },
      { kind: "revision", hunkId: "h1", before: "十日", after: "五日", rationale: "缩短账期" },
      { kind: "text", text: "内付款。" },
    ]);
  });
});

describe("composeWordSurface", () => {
  it("paints pending hunks onto the open file and falls back to the baseline only when the file is empty", () => {
    const proposal: RedlineProposal = {
      taskId: "t1",
      baselineSections: [{ heading: "付款", body: "甲方应于五日内付款。" }],
      hunks: [
        {
          hunkId: "pending-1",
          sectionIndex: 0,
          sectionHeading: "付款",
          before: "五日",
          after: "三日",
          status: "pending",
          granularity: "surgical",
        },
        {
          hunkId: "kept",
          sectionIndex: 0,
          before: "十日",
          after: "五日",
          status: "accepted",
          granularity: "surgical",
        },
      ],
      updatedAt: "2026-09-27T00:00:00.000Z",
    };
    const fromFile = composeWordSurface({
      fileName: "补充协议.docx",
      relPath: "cases/m/补充协议.docx",
      root: "workspace",
      docxParagraphs: ["甲方应于五日内付款。"],
      draft: { taskId: "t1" } as ArtifactDraft,
      proposal,
    });
    expect(fromFile.taskId).toBe("t1");
    expect(fromFile.summary).toEqual({ pending: 1, accepted: 1, rejected: 0 });
    expect(JSON.stringify(fromFile.paragraphs)).toContain("五日");
    expect(JSON.stringify(fromFile.paragraphs)).toContain("三日");
    expect(fromFile.hunks.find((hunk) => hunk.hunkId === "pending-1")?.placed).toBe(true);

    const fromBaseline = composeWordSurface({
      fileName: "补充协议.docx",
      relPath: "cases/m/补充协议.docx",
      root: "workspace",
      docxParagraphs: [],
      draft: { taskId: "t1" } as ArtifactDraft,
      proposal,
    });
    const baselinePage = JSON.stringify(fromBaseline.paragraphs);
    expect(baselinePage).toContain("甲方应于");
    expect(baselinePage).toContain("内付款。");
    expect(fromBaseline.hunks.find((hunk) => hunk.hunkId === "pending-1")?.placed).toBe(true);
  });
});

describe("loadWordSurface", () => {
  it("reads a workspace docx and the draft bound to that path", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-surface-"));
    dirs.push(ws);
    const rel = "cases/m/补充协议.docx";
    const abs = path.join(ws, "cases", "m", "补充协议.docx");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        `<w:p><w:r><w:t>甲方应于十日内付款。</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
    );
    fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));
    const draft: ArtifactDraft = {
      taskId: "task-surface-1",
      title: "补充协议",
      output: "docx",
      templateId: "word/contract-default",
      summary: "",
      sections: [{ heading: "付款", body: "甲方应于五日内付款。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: "2026-09-27T00:00:00.000Z",
      contractEdit: { baselineRelativePath: rel, mode: "surgical", baselineRoot: "workspace" },
    };
    persistDraft(ws, draft);
    writeRedlineProposal(ws, {
      taskId: draft.taskId,
      baselineSections: [{ heading: "付款", body: "底稿不该盖住打开的文件。" }],
      hunks: [
        {
          hunkId: "h-pay",
          sectionIndex: 0,
          sectionHeading: "付款",
          before: "十日",
          after: "五日",
          status: "pending",
          granularity: "surgical",
        },
      ],
      updatedAt: "2026-09-27T01:00:00.000Z",
    });

    const loaded = await loadWordSurface({
      workspaceDir: ws,
      root: "workspace",
      relPath: rel,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.snapshot.fileName).toBe("补充协议.docx");
    expect(loaded.snapshot.hunks[0]?.hunkId).toBe("h-pay");
    const page = JSON.stringify(loaded.snapshot.paragraphs);
    expect(page).toContain("十日");
    expect(page).toContain("五日");
    expect(page).not.toContain("底稿不该盖住打开的文件");
    expect(loaded.snapshot.fileMtimeMs).toEqual(expect.any(Number));
    const again = await loadWordSurface({
      workspaceDir: ws,
      root: "workspace",
      relPath: rel,
      seenFileMtime: loaded.snapshot.fileMtimeMs,
      seenProposalAt: "2026-09-27T01:00:00.000Z",
    });
    expect(again).toEqual({ ok: true, unchanged: true });
  });

  it("stops on .doc and asks the lawyer to save as .docx", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-surface-doc-"));
    dirs.push(ws);
    const rel = "cases/m/旧稿.doc";
    const abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "plain");
    const loaded = await loadWordSurface({
      workspaceDir: ws,
      root: "workspace",
      relPath: rel,
    });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error).toMatch(/另存为同名的 \.docx/);
    }
    expect(fs.existsSync(path.join(ws, "cases/m/旧稿.docx"))).toBe(false);
  });
});

describe("extractDocxParagraphsFromXml", () => {
  it("keeps paragraph order and drops empty paragraphs", () => {
    const xml =
      `<w:p><w:r><w:t>第一段</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t></w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>第二段</w:t></w:r></w:p>`;
    expect(extractDocxParagraphsFromXml(xml)).toEqual(["第一段", "第二段"]);
  });
});
