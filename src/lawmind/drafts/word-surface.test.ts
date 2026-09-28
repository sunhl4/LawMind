import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { persistDraft } from "./index.js";
import { writeRedlineProposal, type RedlineProposal } from "./redline-proposal.js";
import { readRedlineProposal } from "./redline-proposal.js";
import { extractDocxLayout } from "./word-surface-layout.js";
import {
  composeWordSurface,
  extractDocxParagraphsFromXml,
  loadWordSurface,
  paintPendingRevisions,
  recordLawyerSurfaceEdit,
  revisionPieces,
  syncLawyerSurfaceDocument,
} from "./word-surface.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("revisionPieces", () => {
  it("keeps the sentence and marks only a short suffix", () => {
    const sentence = "教导甲方人员遵守保洁制度，共同维护室内外卫生。";
    expect(revisionPieces(sentence, `${sentence}你好`)).toEqual([
      { kind: "text", text: sentence },
      { kind: "change", before: "", after: "你好" },
    ]);
    const painted = paintPendingRevisions(sentence, [
      { hunkId: "h", before: sentence, after: `${sentence}你好` },
    ]);
    expect(painted).toEqual([
      { kind: "text", text: sentence },
      { kind: "revision", hunkId: "h", before: "", after: "你好" },
    ]);
  });
});

describe("paintPendingRevisions", () => {
  it("marks the changed span and leaves the rest", () => {
    const segments = paintPendingRevisions("甲方应于十日内付款。", [
      { hunkId: "h1", before: "十日", after: "五日", rationale: "缩短账期" },
    ]);
    expect(segments).toEqual([
      { kind: "text", text: "甲方应于" },
      { kind: "revision", hunkId: "h1", before: "十", after: "五", rationale: "缩短账期" },
      { kind: "text", text: "日" },
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
    expect(JSON.stringify(fromFile.paragraphs)).toContain("五");
    expect(JSON.stringify(fromFile.paragraphs)).toContain("三");
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
    expect(page).toContain("十");
    expect(page).toContain("五");
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

  it("drops w14:paraId and other start-tag attributes from the visible text", () => {
    const xml =
      `<w:p w14:paraId="036DE1E2" w14:textId="77777777"><w:r><w:t></w:t></w:r></w:p>` +
      `<w:p w14:paraId="6F44A189"><w:r><w:t>914400419100</w:t></w:r></w:p>` +
      `<w:p w14:paraId="00FAB3B0"/>` +
      `<w:p w14:paraId="73623348"></w:p>` +
      `<w:p w14:paraId="32ECBB3D"><w:pPr><w:pStyle w:val="Title"/></w:pPr>` +
      `<w:r><w:t>保洁服务委托</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>合同</w:t></w:r></w:p>` +
      `<w:p w14:paraId="6DF1AF61"><w:r><w:t>采购方（甲方）：</w:t></w:r></w:p>` +
      `<w:p w:title="a>b"><w:r><w:t>3 &gt; 2</w:t></w:r></w:p>`;
    expect(extractDocxParagraphsFromXml(xml)).toEqual([
      "914400419100",
      "保洁服务委托\n合同",
      "采购方（甲方）：",
      "3 > 2",
    ]);
  });

  it("shows the cached TOC result and drops field instructions", () => {
    const xml =
      `<w:p><w:r><w:t>目录</w:t></w:r></w:p>` +
      `<w:p>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> TOC \\o "1-1" \\h \\z \\u </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> HYPERLINK \\l "_Toc175662705" </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      `<w:r><w:t>1</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>合同目的</w:t></w:r><w:r><w:tab/></w:r>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> PAGEREF _Toc175662705 \\h </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      `<w:r><w:t>2</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `</w:p>` +
      `<w:p><w:r><w:instrText>DATE \\@ "yyyy"</w:instrText></w:r></w:p>` +
      `<w:p><w:r><w:t>采购方（甲方）：</w:t></w:r></w:p>`;
    expect(extractDocxParagraphsFromXml(xml)).toEqual([
      "目录",
      "1\t合同目的\t2",
      "采购方（甲方）：",
    ]);
  });
});

describe("recordLawyerSurfaceEdit", () => {
  it("stores a lawyer sentence edit on the same redline list, and a second pass updates it", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-lawyer-"));
    dirs.push(ws);
    const first = recordLawyerSurfaceEdit({
      workspaceDir: ws,
      relPath: "cases/m/合同.docx",
      root: "workspace",
      fileName: "合同.docx",
      before: "甲方应于十日内付款。",
      after: "甲方应于五日内付款。",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = recordLawyerSurfaceEdit({
      workspaceDir: ws,
      relPath: "cases/m/合同.docx",
      root: "workspace",
      fileName: "合同.docx",
      before: "甲方应于十日内付款。",
      after: "甲方应于三日内付款。",
      taskId: first.taskId,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.hunkId).toBe(first.hunkId);
    expect(readRedlineProposal(ws, first.taskId)?.hunks).toEqual([
      expect.objectContaining({
        before: "甲方应于十日内付款。",
        after: "甲方应于三日内付款。",
        status: "pending",
        rationale: "律师在正文里改的",
        granularity: "surgical",
      }),
    ]);
  });

  it("drops the revision when the paragraph is typed back, and adds one when text is inserted", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-lawyer-sync-"));
    dirs.push(ws);
    const sentence = "教导甲方人员遵守保洁制度，共同维护室内外卫生。";
    const first = recordLawyerSurfaceEdit({
      workspaceDir: ws,
      relPath: "cases/m/合同.docx",
      root: "workspace",
      fileName: "合同.docx",
      before: sentence,
      after: `${sentence}你好`,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const cleared = syncLawyerSurfaceDocument({
      workspaceDir: ws,
      relPath: "cases/m/合同.docx",
      root: "workspace",
      fileName: "合同.docx",
      taskId: first.taskId,
      paragraphs: [{ baseline: sentence, current: sentence }],
    });
    expect(cleared.ok).toBe(true);
    expect(readRedlineProposal(ws, first.taskId)?.hunks ?? []).toEqual([]);
    const restored = syncLawyerSurfaceDocument({
      workspaceDir: ws,
      relPath: "cases/m/合同.docx",
      root: "workspace",
      fileName: "合同.docx",
      taskId: first.taskId,
      paragraphs: [{ baseline: sentence, current: `${sentence}你好` }],
    });
    expect(restored.ok).toBe(true);
    expect(readRedlineProposal(ws, first.taskId)?.hunks).toEqual([
      expect.objectContaining({
        before: sentence,
        after: `${sentence}你好`,
        status: "pending",
        rationale: "律师在正文里改的",
      }),
    ]);
  });
});

describe("formatted word surface", () => {
  it("keeps alignment and size, and paints every revision in a stable color", () => {
    const numbering =
      `<w:numbering><w:abstractNum w:abstractNumId="0">` +
      `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
      `</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
    const styles =
      `<w:styles><w:style w:styleId="24"><w:name w:val="No Spacing"/>` +
      `<w:rPr><w:sz w:val="22"/></w:rPr></w:style></w:styles>`;
    const xml =
      `<w:document><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="24"/><w:jc w:val="center"/>` +
      `<w:rPr><w:color w:val="5B9BD5"/></w:rPr></w:pPr>` +
      `<w:r><w:rPr><w:b/><w:sz w:val="80"/></w:rPr><w:t>保洁服务委托合同</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
      `<w:r><w:t>甲方应于十日内付款。</w:t></w:r></w:p>` +
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>甲方</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t>乙方</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
      `</w:body></w:document>`;
    const layout = extractDocxLayout(xml, styles, numbering);
    const surface = composeWordSurface({
      fileName: "保洁.docx",
      relPath: "保洁.docx",
      root: "workspace",
      docxParagraphs: [],
      layout,
      proposal: {
        taskId: "t",
        baselineSections: [],
        hunks: [
          {
            hunkId: "done",
            sectionIndex: 0,
            before: "十日",
            after: "五日",
            status: "accepted",
            granularity: "surgical",
          },
          {
            hunkId: "wait",
            sectionIndex: 0,
            before: "付款",
            after: "支付",
            status: "pending",
            granularity: "surgical",
          },
        ],
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
    });
    const title = surface.blocks[0];
    expect(title?.kind).toBe("paragraph");
    if (title?.kind === "paragraph") {
      expect(title.align).toBe("center");
      expect(title.tight).toBe(true);
      expect(title.segments[0]).toMatchObject({
        text: "保洁服务委托合同",
        bold: true,
        fontSizePx: 53,
        fontColor: "#5B9BD5",
      });
    }
    const clause = surface.blocks[1];
    expect(clause?.kind).toBe("paragraph");
    if (clause?.kind === "paragraph") {
      expect(clause.listLabel).toBe("1.");
      const accepted = clause.segments.find(
        (segment) => segment.kind === "revision" && segment.hunkId === "done",
      );
      const pending = clause.segments.find(
        (segment) => segment.kind === "revision" && segment.hunkId === "wait",
      );
      expect(accepted).toMatchObject({ color: 0, before: "十", after: "五" });
      expect(pending).toMatchObject({ color: 1, before: "付款", after: "支付" });
    }
    const table = surface.blocks[2];
    expect(table?.kind).toBe("table");
    if (table && table.kind === "table") {
      const rowText = table.rows[0]?.map((cell) => {
        const paragraph = cell.blocks[0];
        if (!paragraph || paragraph.kind !== "paragraph") {
          return "";
        }
        return paragraph.segments
          .map((segment) => (segment.kind === "text" ? segment.text : ""))
          .join("");
      });
      expect(rowText).toEqual(["甲方", "乙方"]);
    }
    expect(surface.hunks.find((hunk) => hunk.hunkId === "done")?.color).toBe(0);
    expect(surface.hunks.find((hunk) => hunk.hunkId === "wait")?.color).toBe(1);
    expect(surface.hunks[0]?.hunkId).toBe("wait");
  });
});
