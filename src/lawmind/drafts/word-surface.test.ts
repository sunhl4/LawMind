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
  trackCoversHunk,
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
      expect.objectContaining({
        kind: "tracked",
        change: "ins",
        author: "LawMind",
        text: "你好",
      }),
    ]);
  });
});

describe("trackCoversHunk", () => {
  it("matches a balloon to the hunk it was painted from", () => {
    const hunk = { before: "十日", after: "五日" };
    expect(trackCoversHunk({ change: "del", text: "十" }, hunk)).toBe(true);
    expect(trackCoversHunk({ change: "ins", text: "五" }, hunk)).toBe(true);
    expect(trackCoversHunk({ change: "ins", text: "付款" }, hunk)).toBe(false);
  });
});

describe("paintPendingRevisions", () => {
  it("marks the changed span and leaves the rest", () => {
    const segments = paintPendingRevisions("甲方应于十日内付款。", [
      { hunkId: "h1", before: "十日", after: "五日", rationale: "缩短账期" },
    ]);
    expect(segments).toEqual([
      { kind: "text", text: "甲方应于" },
      expect.objectContaining({ kind: "tracked", change: "del", author: "LawMind", text: "十" }),
      expect.objectContaining({ kind: "tracked", change: "ins", author: "LawMind", text: "五" }),
      { kind: "text", text: "日内付款。" },
    ]);
  });
});

describe("composeWordSurface", () => {
  it("labels lawyer hunks with the local display name", () => {
    const proposal: RedlineProposal = {
      taskId: "t-lawyer",
      baselineSections: [{ heading: "正文", body: "甲方应于五日内付款。" }],
      hunks: [
        {
          hunkId: "l1",
          sectionIndex: 0,
          before: "五日",
          after: "三日",
          status: "pending",
          granularity: "surgical",
          rationale: "律师在正文里改的",
        },
      ],
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const surface = composeWordSurface({
      fileName: "补充协议.docx",
      relPath: "cases/m/补充协议.docx",
      root: "workspace",
      docxParagraphs: ["甲方应于五日内付款。"],
      draft: { taskId: "t-lawyer" } as ArtifactDraft,
      proposal,
      lawyerDisplayName: "张三",
    });
    expect(surface.lawyerDisplayName).toBe("张三");
    expect(surface.hunks[0]?.author).toBe("张三");
  });

  it("attributes engine tracks to 设置 → 修订署名 instead of LawMind", () => {
    const proposal: RedlineProposal = {
      taskId: "t-author",
      baselineSections: [{ heading: "正文", body: "甲方应于十日内付款。" }],
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "十日",
          after: "五日",
          status: "pending",
          granularity: "surgical",
          rationale: "缩短账期",
        },
      ],
      updatedAt: "2026-10-07T00:00:00.000Z",
    };
    const surface = composeWordSurface({
      fileName: "补充协议.docx",
      relPath: "cases/m/补充协议.docx",
      root: "workspace",
      docxParagraphs: ["甲方应于十日内付款。"],
      draft: { taskId: "t-author" } as ArtifactDraft,
      proposal,
      wordRevisionAuthor: "国浩-吕盈修",
    });
    expect(surface.revisionAuthor).toBe("国浩-吕盈修");
    expect(surface.hunks[0]?.author).toBe("国浩-吕盈修");
    expect(surface.tracked?.every((row) => row.author === "国浩-吕盈修")).toBe(true);
    expect(surface.paragraphs[0]?.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tracked",
          change: "del",
          author: "国浩-吕盈修",
          text: "十",
        }),
        expect.objectContaining({
          kind: "tracked",
          change: "ins",
          author: "国浩-吕盈修",
          text: "五",
        }),
      ]),
    );
  });

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

  it("paints a surgical insertion at the end of the matching paragraph", () => {
    const body = "1.2 货物清单及价格见附件1。";
    const inserted = "货物的名称以附件1为准。";
    const proposal: RedlineProposal = {
      taskId: "t-ins",
      baselineSections: [{ heading: "第 9 段", body }],
      hunks: [
        {
          hunkId: "ins-1",
          sectionIndex: 0,
          sectionHeading: "第 9 段",
          before: "",
          after: inserted,
          spanStart: body.length,
          spanEnd: body.length,
          status: "pending",
          granularity: "surgical",
        },
      ],
      updatedAt: "2026-09-28T00:00:00.000Z",
    };
    const surface = composeWordSurface({
      fileName: "合同.docx",
      relPath: "非技术相关/合同.docx",
      root: "project",
      docxParagraphs: [body, "下一条不动。"],
      draft: { taskId: "t-ins" } as ArtifactDraft,
      proposal,
    });
    expect(surface.hunks.find((hunk) => hunk.hunkId === "ins-1")?.placed).toBe(true);
    const page = JSON.stringify(surface.paragraphs);
    expect(page).toContain(body);
    expect(page).toContain(inserted);
    expect(page).toContain('"kind":"tracked"');
    expect(page).toContain("下一条不动。");
  });

  it("keeps an insertion when the open paragraph is a unique slice of the baseline section", () => {
    const slice =
      "乙句后半从这里开始，这段要明显长过四十个字，才能算作被拆开的那一节正文，直到句号。";
    const body = `甲句。${slice}`;
    const inserted = "补充。";
    const at = body.indexOf(slice);
    const proposal: RedlineProposal = {
      taskId: "t-slice",
      baselineSections: [{ heading: "第 1 段", body }],
      hunks: [
        {
          hunkId: "ins-slice",
          sectionIndex: 0,
          sectionHeading: "第 1 段",
          before: "",
          after: inserted,
          spanStart: at + 2,
          spanEnd: at + 2,
          status: "pending",
          granularity: "surgical",
        },
      ],
      updatedAt: "2026-09-28T00:00:00.000Z",
    };
    const surface = composeWordSurface({
      fileName: "合同.docx",
      relPath: "合同.docx",
      root: "project",
      docxParagraphs: [slice],
      draft: { taskId: "t-slice" } as ArtifactDraft,
      proposal,
    });
    expect(surface.hunks[0]?.placed).toBe(true);
    expect(JSON.stringify(surface.paragraphs)).toContain(inserted);
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
    expect(loaded.snapshot.revisionAuthor).toBe("LawMind");
    const again = await loadWordSurface({
      workspaceDir: ws,
      root: "workspace",
      relPath: rel,
      seenFileMtime: loaded.snapshot.fileMtimeMs,
      seenProposalAt: "2026-09-27T01:00:00.000Z",
    });
    expect(again).toEqual({ ok: true, unchanged: true });
  });

  it("attributes pending tracks to 设置 → 修订署名 from the workspace policy", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-surface-author-"));
    dirs.push(ws);
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      `${JSON.stringify({ schemaVersion: 1, wordRevisionAuthor: "国浩-吕盈修" })}\n`,
    );
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
    persistDraft(ws, {
      taskId: "task-author-1",
      title: "补充协议",
      output: "docx",
      templateId: "word/contract-default",
      summary: "",
      sections: [{ heading: "付款", body: "甲方应于十日内付款。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: "2026-10-07T00:00:00.000Z",
      contractEdit: { baselineRelativePath: rel, mode: "surgical", baselineRoot: "workspace" },
    });
    writeRedlineProposal(ws, {
      taskId: "task-author-1",
      baselineSections: [{ heading: "付款", body: "甲方应于十日内付款。" }],
      hunks: [
        {
          hunkId: "h-pay",
          sectionIndex: 0,
          sectionHeading: "付款",
          before: "十日",
          after: "五日",
          status: "pending",
          granularity: "surgical",
          rationale: "缩短账期",
        },
      ],
      updatedAt: "2026-10-07T01:00:00.000Z",
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
    expect(loaded.snapshot.revisionAuthor).toBe("国浩-吕盈修");
    expect(loaded.snapshot.tracked?.every((row) => row.author === "国浩-吕盈修")).toBe(true);
    expect(JSON.stringify(loaded.snapshot.paragraphs)).toContain("国浩-吕盈修");
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
      layout: layout.blocks,
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
      expect(title.spaceBefore).toEqual({ unit: "px", value: 0 });
      expect(title.spaceAfter).toEqual({ unit: "px", value: 0 });
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
      expect(clause.segments.map((segment) => segment.text).join("")).toContain("五日");
      expect(clause.segments.some((segment) => segment.kind === "revision")).toBe(false);
      const acceptedDel = clause.segments.find(
        (segment) =>
          segment.kind === "tracked" && segment.change === "del" && segment.text === "十",
      );
      const acceptedIns = clause.segments.find(
        (segment) =>
          segment.kind === "tracked" && segment.change === "ins" && segment.text === "五",
      );
      expect(acceptedDel).toMatchObject({ color: 0, author: "LawMind" });
      expect(acceptedIns).toMatchObject({ color: 0, author: "LawMind" });
      const pendingDel = clause.segments.find(
        (segment) =>
          segment.kind === "tracked" && segment.change === "del" && segment.text === "付款",
      );
      const pendingIns = clause.segments.find(
        (segment) =>
          segment.kind === "tracked" && segment.change === "ins" && segment.text === "支付",
      );
      expect(pendingDel).toMatchObject({ color: 0, author: "LawMind" });
      expect(pendingIns).toMatchObject({ color: 0, author: "LawMind" });
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
    expect(surface.hunks.find((hunk) => hunk.hunkId === "wait")?.color).toBe(0);
    expect(surface.hunks[0]?.hunkId).toBe("wait");
  });

  it("uses Word's paper, 宋体, line spacing, and character indent", () => {
    const styles =
      `<w:styles><w:docDefaults><w:rPrDefault><w:rPr>` +
      `<w:rFonts w:ascii="Times New Roman" w:eastAsia="SimSun" w:hAnsi="Times New Roman"/>` +
      `<w:sz w:val="24"/></w:rPr></w:rPrDefault>` +
      `<w:pPrDefault><w:pPr><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:styleId="BodyText2"><w:name w:val="正文2"/>` +
      `<w:pPr><w:spacing w:before="50" w:beforeLines="50" w:after="50" w:afterLines="50" w:line="360" w:lineRule="auto"/>` +
      `<w:ind w:firstLine="200" w:firstLineChars="200"/><w:jc w:val="both"/></w:pPr>` +
      `<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="SimSun" w:hAnsi="Times New Roman"/>` +
      `<w:sz w:val="24"/></w:rPr></w:style></w:styles>`;
    const xml =
      `<w:document><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="BodyText2"/></w:pPr>` +
      `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="SimSun" w:hAnsi="Times New Roman"/>` +
      `<w:sz w:val="24"/></w:rPr><w:t>先写结论。</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:spacing w:after="360" w:before="0" w:line="320" w:lineRule="atLeast"/>` +
      `<w:ind w:firstLine="480"/></w:pPr>` +
      `<w:r><w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun"/>` +
      `<w:sz w:val="24"/></w:rPr><w:t>一、结论</w:t></w:r></w:p>` +
      `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>` +
      `<w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="4800"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>` +
      `<w:p><w:r><w:t>签署</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
      `<w:sectPr><w:pgSz w:w="11905" w:h="16837"/>` +
      `<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr>` +
      `</w:body></w:document>`;
    const doc = extractDocxLayout(xml, styles, "");
    expect(doc.page.widthPx).toBe(793.7);
    expect(doc.page.marginTopPx).toBe(96);
    expect(doc.page.marginLeftPx).toBe(120);
    expect(doc.page.fontFamily).toContain("Times New Roman");
    expect(doc.page.fontFamily).toContain("Songti SC");
    expect(doc.page.fontSizePx).toBe(16);
    const body = doc.blocks[0];
    expect(body?.kind).toBe("paragraph");
    if (body?.kind === "paragraph") {
      expect(body.align).toBe("both");
      expect(body.firstIndent).toEqual({ unit: "em", value: 2 });
      expect(body.spaceBefore).toEqual({ unit: "line", value: 0.5 });
      expect(body.spaceAfter).toEqual({ unit: "line", value: 0.5 });
      expect(body.line).toEqual({ rule: "auto", multiple: 1.5 });
      expect(body.runs[0]?.fontFamily).toContain("Times New Roman");
      expect(body.runs[0]?.fontFamily?.indexOf("Times New Roman")).toBeLessThan(
        body.runs[0]?.fontFamily?.indexOf("Songti SC") ?? -1,
      );
      expect(body.runs[0]?.fontSizePx).toBe(16);
    }
    const heading = doc.blocks[1];
    expect(heading?.kind).toBe("paragraph");
    if (heading?.kind === "paragraph") {
      expect(heading.firstIndent).toEqual({ unit: "px", value: 32 });
      expect(heading.spaceBefore).toEqual({ unit: "px", value: 0 });
      expect(heading.spaceAfter).toEqual({ unit: "px", value: 24 });
      expect(heading.line).toEqual({ rule: "atLeast", px: 21.3 });
      expect(heading.runs[0]?.fontFamily?.startsWith("SimSun")).toBe(true);
    }
    const table = doc.blocks[2];
    expect(table?.kind).toBe("table");
    if (table?.kind === "table") {
      expect(table.bordered).toBe(true);
      expect(table.widthPct).toBe(100);
      expect(table.colWidthsPx).toEqual([160, 320]);
      expect(table.rows[0]?.[0]?.colspan).toBe(2);
      expect(table.rows[0]?.[0]?.widthPx).toBe(480);
    }
  });

  it("keeps Table Grid borders and vertical header cells", () => {
    const styles =
      `<w:styles><w:style w:type="table" w:styleId="TableGrid">` +
      `<w:name w:val="Table Grid"/>` +
      `<w:tblPr><w:tblBorders>` +
      `<w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/>` +
      `<w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>` +
      `<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/>` +
      `</w:tblBorders></w:tblPr></w:style></w:styles>`;
    const xml =
      `<w:document><w:body>` +
      `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>` +
      `<w:tblW w:w="5000" w:type="pct"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="900"/><w:gridCol w:w="900"/><w:gridCol w:w="3200"/></w:tblGrid>` +
      `<w:tr>` +
      `<w:tc><w:tcPr><w:vAlign w:val="center"/></w:tcPr>` +
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>序号</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:textDirection w:val="tbRl"/><w:vAlign w:val="center"/></w:tcPr>` +
      `<w:p><w:r><w:t>名称</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t>配置描述</w:t></w:r></w:p></w:tc>` +
      `</w:tr>` +
      `<w:tr>` +
      `<w:tc><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>1</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>` +
      `</w:tr>` +
      `</w:tbl>` +
      `</w:body></w:document>`;
    const doc = extractDocxLayout(xml, styles, "");
    const table = doc.blocks[0];
    expect(table?.kind).toBe("table");
    if (table?.kind === "table") {
      expect(table.bordered).toBe(true);
      expect(table.colWidthsPx).toEqual([60, 60, 213.3]);
      expect(table.rows[0]?.[0]?.vAlign).toBe("center");
      expect(table.rows[0]?.[1]?.vertical).toBe(true);
      expect(table.rows[0]?.[1]?.blocks[0]).toMatchObject({
        kind: "paragraph",
        text: "名称",
      });
      expect(table.rows[1]?.[0]?.blocks[0]).toMatchObject({
        kind: "paragraph",
        align: "center",
        text: "1",
      });
    }
  });

  it("reads a WPS price-list grid: cell borders, 宋体;SimSun, and a two-line header", () => {
    const xml =
      `<w:document><w:body>` +
      `<w:tbl><w:tblPr><w:tblW w:w="9087" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="582"/><w:gridCol w:w="765"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="582" w:type="dxa"/>` +
      `<w:tcBorders><w:top w:val="single" w:sz="12"/><w:start w:val="single" w:sz="12"/>` +
      `<w:bottom w:val="single" w:sz="12"/><w:end w:val="single" w:sz="12"/></w:tcBorders>` +
      `<w:vAlign w:val="center"/></w:tcPr>` +
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
      `<w:r><w:rPr><w:rFonts w:ascii="宋体;SimSun" w:hAnsi="宋体;SimSun"/><w:b/><w:sz w:val="24"/></w:rPr>` +
      `<w:t>序号</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="765" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>品牌</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>型号</w:t></w:r></w:p></w:tc>` +
      `</w:tr></w:tbl></w:body></w:document>`;
    const doc = extractDocxLayout(xml, "", "");
    const table = doc.blocks[0];
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") {
      return;
    }
    expect(table.bordered).toBe(true);
    expect(table.widthPx).toBe(605.8);
    expect(table.colWidthsPx).toEqual([38.8, 51]);
    const serial = table.rows[0]?.[0]?.blocks[0];
    expect(serial).toMatchObject({ kind: "paragraph", align: "center", text: "序号" });
    if (serial?.kind === "paragraph") {
      expect(serial.runs[0]?.fontFamily?.startsWith("SimSun")).toBe(true);
      expect(serial.runs[0]?.bold).toBe(true);
    }
    const brand = table.rows[0]?.[1]?.blocks.map((block) =>
      block.kind === "paragraph" ? block.text : "",
    );
    expect(brand).toEqual(["品牌", "型号"]);
    expect(table.rows[0]?.[0]?.vAlign).toBe("center");
  });

  it("keeps Word's own insertions and deletions, one color per author", () => {
    const xml =
      `<w:document><w:body>` +
      `<w:p>` +
      `<w:r><w:t>甲方应于</w:t></w:r>` +
      `<w:del w:id="1" w:author="李律师" w:date="2026-10-01T00:00:00Z"><w:r><w:delText>十日</w:delText></w:r></w:del>` +
      `<w:ins w:id="2" w:author="李律师" w:date="2026-10-01T00:00:00Z"><w:r><w:t>五日</w:t></w:r></w:ins>` +
      `<w:r><w:t>内付款。</w:t></w:r>` +
      `<w:ins w:id="3" w:author="王律师"><w:r><w:t>逾期支付违约金。</w:t></w:r></w:ins>` +
      `</w:p>` +
      `</w:body></w:document>`;
    const layout = extractDocxLayout(xml);
    const paragraph = layout.blocks[0];
    expect(paragraph?.kind).toBe("paragraph");
    if (paragraph?.kind !== "paragraph") {
      return;
    }
    expect(paragraph.text).toBe("甲方应于五日内付款。逾期支付违约金。");
    expect(paragraph.runs.map((run) => [run.text, run.track?.kind, run.track?.author])).toEqual([
      ["甲方应于", undefined, undefined],
      ["十日", "del", "李律师"],
      ["五日", "ins", "李律师"],
      ["内付款。", undefined, undefined],
      ["逾期支付违约金。", "ins", "王律师"],
    ]);
    const surface = composeWordSurface({
      fileName: "合同.docx",
      relPath: "合同.docx",
      root: "workspace",
      docxParagraphs: [],
      layout: layout.blocks,
    });
    const painted = surface.blocks[0];
    expect(painted?.kind).toBe("paragraph");
    if (painted?.kind !== "paragraph") {
      return;
    }
    expect(painted.segments.filter((segment) => segment.kind === "tracked")).toEqual([
      expect.objectContaining({
        kind: "tracked",
        revId: "1",
        change: "del",
        author: "李律师",
        text: "十日",
        color: 0,
      }),
      expect.objectContaining({
        kind: "tracked",
        revId: "2",
        change: "ins",
        author: "李律师",
        text: "五日",
        color: 0,
      }),
      expect.objectContaining({
        kind: "tracked",
        revId: "3",
        change: "ins",
        author: "王律师",
        text: "逾期支付违约金。",
        color: 1,
      }),
    ]);
    expect(surface.tracked).toEqual([
      expect.objectContaining({
        revId: "1",
        change: "del",
        author: "李律师",
        color: 0,
        text: "十日",
      }),
      expect.objectContaining({
        revId: "2",
        change: "ins",
        author: "李律师",
        color: 0,
        text: "五日",
      }),
      expect.objectContaining({ revId: "3", change: "ins", author: "王律师", color: 1 }),
    ]);
  });

  it("surfaces header and comment tracks with the body", () => {
    const surface = composeWordSurface({
      fileName: "补充协议.docx",
      relPath: "cases/m/补充协议.docx",
      root: "workspace",
      docxParagraphs: ["正文"],
      headerLayout: [
        {
          kind: "paragraph",
          runs: [{ text: "页眉", track: { kind: "ins", id: "7", author: "李律师" } }],
          text: "页眉",
        },
      ],
      docxComments: [{ commentId: "1", author: "李律师", body: "看这里", anchorText: "正文" }],
    });
    expect(surface.headerBlocks?.[0]?.kind).toBe("paragraph");
    if (surface.headerBlocks?.[0]?.kind === "paragraph") {
      expect(surface.headerBlocks[0].storyPart).toBe("word/header1.xml");
      expect(surface.headerBlocks[0].sourceIndex).toBe(0);
    }
    expect(surface.tracked?.some((row) => row.revId === "7" && row.author === "李律师")).toBe(true);
    expect(surface.docxComments?.[0]?.body).toBe("看这里");
  });
});
