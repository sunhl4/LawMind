/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  acceptParagraphTracks,
  applyEngineInsert,
  authorClockFor,
  editHitsForeignTrack,
  isOwnRevisionAuthor,
  paragraphRunsOf,
  snapshotHasEngine,
  snapshotSplitParagraph,
  snapshotWithRuns,
  splitRunsAt,
  storyParagraphOffset,
  wordMarkContentLength,
  wordMarkOffset,
} from "./word-surface-engine";
import { makeAuthorClock } from "../../../../../src/lawmind/drafts/word-revision/index.ts";
import type { WordSurfaceSnapshot } from "../../../../../src/lawmind/drafts/word-surface.ts";

describe("word surface engine helpers", () => {
  it("treats snapshots with runs as the Word engine", () => {
    expect(
      snapshotHasEngine({ paragraphs: [{ segments: [] }] } as unknown as WordSurfaceSnapshot),
    ).toBe(false);
    expect(
      snapshotHasEngine({
        paragraphs: [{ segments: [], runs: [{ text: "甲" }] }],
      } as unknown as WordSurfaceSnapshot),
    ).toBe(true);
  });

  it("treats only 修订署名 as the local author", () => {
    const snap = {
      revisionAuthor: "国浩-吕盈修",
      paragraphs: [{ segments: [] }],
    } as unknown as WordSurfaceSnapshot;
    expect(isOwnRevisionAuthor("国浩-吕盈修", snap)).toBe(true);
    expect(isOwnRevisionAuthor("李律师", snap)).toBe(false);
    expect(isOwnRevisionAuthor("LawMind", snap)).toBe(false);
  });

  it("uses 修订署名 for new marks", () => {
    const clock = authorClockFor({
      revisionAuthor: "国浩-吕盈修",
      lawyerDisplayName: "张三",
      paragraphs: [{ segments: [], runs: [{ text: "甲" }] }],
    } as unknown as WordSurfaceSnapshot);
    expect(clock.name).toBe("国浩-吕盈修");
  });

  it("refuses to edit inside someone else's track", () => {
    const runs = [{ text: "五日", track: { kind: "ins" as const, id: "2", author: "李律师" } }];
    const inside = { offset: 1, start: 1, end: 1 };
    expect(editHitsForeignTrack(runs, inside, "国浩-吕盈修", "insert")).toBe(true);
    expect(editHitsForeignTrack(runs, inside, "国浩-吕盈修", "delete-back")).toBe(true);
    expect(editHitsForeignTrack(runs, { offset: 2, start: 2, end: 2 }, "国浩-吕盈修", "insert")).toBe(false);
  });

  it("marks an accepted track without dropping the insertion", () => {
    const next = acceptParagraphTracks(
      [[{ text: "五日", track: { kind: "ins", id: "2", author: "国浩-吕盈修" } }]],
      ["2"],
    );
    expect(next[0]?.[0]?.track).toMatchObject({ kind: "ins", id: "2", disposition: "accepted" });
    expect(next[0]?.[0]?.text).toBe("五日");
  });

  it("inserts with the current author even inside someone else's mark", () => {
    const zhang = makeAuthorClock("张律师", 3);
    const next = applyEngineInsert(
      [
        { text: "五日", track: { kind: "ins", id: "2", author: "李律师" } },
      ],
      { offset: 2, start: 2, end: 2 },
      "内",
      zhang,
    );
    expect(next.map((run) => [run.text, run.track?.author])).toEqual([
      ["五日", "李律师"],
      ["内", "张律师"],
    ]);
  });

  it("counts a rendered line break as one caret position", () => {
    const mark = document.createElement("span");
    mark.dataset.allFrom = "0";
    mark.append("甲");
    mark.appendChild(document.createElement("br"));
    mark.append("乙");
    expect(wordMarkContentLength(mark)).toBe(3);
    const second = mark.lastChild;
    expect(second).toBeInstanceOf(Text);
    if (second instanceof Text) {
      expect(wordMarkOffset(mark, second, 0)).toBe(2);
      expect(wordMarkOffset(mark, second, 1)).toBe(3);
    }
    const page = document.createElement("span");
    page.dataset.wordBreak = "page";
    mark.appendChild(page);
    expect(wordMarkContentLength(mark)).toBe(4);
  });

  it("rebuilds tracked balloons from runs", () => {
    const snapshot = snapshotWithRuns(
      {
        fileName: "a.docx",
        relPath: "a.docx",
        root: "workspace",
        taskId: null,
        updatedAt: null,
        blocks: [{ kind: "paragraph", segments: [], runs: [{ text: "甲" }] }],
        paragraphs: [{ segments: [], runs: [{ text: "甲" }] }],
        hunks: [],
        summary: { pending: 0, accepted: 0, rejected: 0 },
      },
      [[{ text: "乙", track: { kind: "ins", id: "1", author: "张三" } }]],
    );
    expect(snapshot.tracked).toEqual([
      expect.objectContaining({ revId: "1", change: "ins", author: "张三", text: "乙" }),
    ]);
    expect(snapshot.paragraphs[0]?.segments[0]).toEqual(
      expect.objectContaining({ kind: "tracked", author: "张三", text: "乙" }),
    );
  });

  it("splits runs at an offset and inserts a new paragraph with sourceIndex null", () => {
    const runs = [{ text: "甲方应于十日内付款。" }];
    const { before, after } = splitRunsAt(runs, 4);
    expect(before.map((run) => run.text).join("")).toBe("甲方应于");
    expect(after.map((run) => run.text).join("")).toBe("十日内付款。");
    const snapshot = snapshotSplitParagraph(
      {
        fileName: "a.docx",
        relPath: "a.docx",
        root: "workspace",
        taskId: null,
        updatedAt: null,
        blocks: [
          {
            kind: "paragraph",
            segments: [],
            runs,
            sourceIndex: 0,
            pPrInner: "<w:jc w:val=\"both\"/>",
          },
        ],
        paragraphs: [{ segments: [], runs, sourceIndex: 0, pPrInner: "<w:jc w:val=\"both\"/>" }],
        hunks: [],
        summary: { pending: 0, accepted: 0, rejected: 0 },
      },
      0,
      before,
      after,
    );
    expect(snapshot.paragraphs).toHaveLength(2);
    expect(snapshot.paragraphs[0]?.sourceIndex).toBe(0);
    expect(snapshot.paragraphs[1]?.sourceIndex).toBeNull();
    expect(snapshot.paragraphs[1]?.pPrInner).toContain("jc");
    expect(snapshot.paragraphs[0]?.runs?.map((run) => run.text).join("")).toBe("甲方应于");
    expect(snapshot.paragraphs[1]?.runs?.map((run) => run.text).join("")).toBe("十日内付款。");
    expect(snapshot.blocks).toHaveLength(2);
  });

  it("includes header paragraphs in the editable run list and writes them back", () => {
    const base = {
      fileName: "a.docx",
      relPath: "a.docx",
      root: "workspace" as const,
      taskId: null,
      updatedAt: null,
      headerBlocks: [
        {
          kind: "paragraph" as const,
          segments: [],
          runs: [{ text: "旧页眉" }],
          sourceIndex: 0,
          storyPart: "word/header1.xml",
        },
      ],
      blocks: [
        {
          kind: "paragraph" as const,
          segments: [],
          runs: [{ text: "正文" }],
          sourceIndex: 0,
          storyPart: "word/document.xml",
        },
      ],
      paragraphs: [
        {
          segments: [],
          runs: [{ text: "正文" }],
          sourceIndex: 0,
          storyPart: "word/document.xml",
        },
      ],
      hunks: [],
      summary: { pending: 0, accepted: 0, rejected: 0 },
    };
    expect(storyParagraphOffset(base)).toBe(1);
    expect(paragraphRunsOf(base).map((runs) => runs.map((r) => r.text).join(""))).toEqual([
      "旧页眉",
      "正文",
    ]);
    const next = snapshotWithRuns(base, [[{ text: "新页眉" }], [{ text: "正文改" }]]);
    expect(
      next.headerBlocks?.[0]?.kind === "paragraph"
        ? next.headerBlocks[0].runs?.map((r) => r.text).join("")
        : "",
    ).toBe("新页眉");
    expect(next.paragraphs[0]?.runs?.map((r) => r.text).join("")).toBe("正文改");
  });

  it("keeps edited runs when the snapshot has paragraphs but no blocks", () => {
    const base = {
      fileName: "a.docx",
      relPath: "a.docx",
      root: "workspace" as const,
      taskId: null,
      updatedAt: null,
      blocks: [],
      paragraphs: [
        {
          segments: [],
          runs: [{ text: "正文" }],
          sourceIndex: 0,
        },
      ],
      hunks: [],
      summary: { pending: 0, accepted: 0, rejected: 0 },
    };
    const next = snapshotWithRuns(base, [[{ text: "改后" }]]);
    expect(next.paragraphs[0]?.runs?.map((run) => run.text).join("")).toBe("改后");
    expect(next.blocks.some((block) => block.kind === "paragraph")).toBe(true);
  });
});
