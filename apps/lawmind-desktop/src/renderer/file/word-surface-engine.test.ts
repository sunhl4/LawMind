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
  snapshotHasEngine,
  snapshotWithRuns,
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
});
