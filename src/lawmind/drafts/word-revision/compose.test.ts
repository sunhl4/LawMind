import { describe, expect, it } from "vitest";
import { assignAuthorColors } from "./color.ts";
import {
  applyFormatRange,
  decideRuns,
  deleteBackward,
  insertText,
  inspectRuns,
  makeAuthorClock,
  maxTrackId,
  replaceRange,
} from "./compose.ts";
import { materializeHunks } from "./materialize.ts";
import type { WordRevisionRun } from "./types.ts";
import { collectBalloons, colorsForRuns, projectRuns } from "./view.ts";

const liDel: WordRevisionRun = {
  text: "十日",
  track: { kind: "del", id: "1", author: "李律师", date: "2026-10-01T00:00:00Z" },
};
const liIns: WordRevisionRun = {
  text: "五日",
  track: { kind: "ins", id: "2", author: "李律师", date: "2026-10-01T00:00:00Z" },
};

function sample(): WordRevisionRun[] {
  return [{ text: "甲方应于" }, liDel, liIns, { text: "付款。" }];
}

describe("Word revision compose", () => {
  it("puts the current lawyer's insert after someone else's insert, in the current lawyer's mark", () => {
    const zhang = makeAuthorClock("张律师", 3);
    const next = insertText(sample(), 8, "内", zhang);
    expect(inspectRuns(next)).toEqual([
      ["甲方应于", undefined, undefined],
      ["十日", "del", "李律师"],
      ["五日", "ins", "李律师"],
      ["内", "ins", "张律师"],
      ["付款。", undefined, undefined],
    ]);
  });

  it("merges continued typing into the current lawyer's own insertion", () => {
    const zhang = makeAuthorClock("张律师", 3);
    const once = insertText(sample(), 8, "内", zhang);
    const twice = insertText(once, 9, "部", zhang);
    expect(inspectRuns(twice)).toEqual([
      ["甲方应于", undefined, undefined],
      ["十日", "del", "李律师"],
      ["五日", "ins", "李律师"],
      ["内部", "ins", "张律师"],
      ["付款。", undefined, undefined],
    ]);
    expect(twice.filter((run) => run.track?.author === "张律师")).toHaveLength(1);
  });

  it("splits another author's insertion instead of inheriting their mark", () => {
    const zhang = makeAuthorClock("张律师", 3);
    const next = insertText(sample(), 7, "个", zhang);
    expect(inspectRuns(next)).toEqual([
      ["甲方应于", undefined, undefined],
      ["十日", "del", "李律师"],
      ["五", "ins", "李律师"],
      ["个", "ins", "张律师"],
      ["日", "ins", "李律师"],
      ["付款。", undefined, undefined],
    ]);
    expect(next.find((run) => run.text === "个")?.track?.author).toBe("张律师");
    expect(
      next
        .filter((run) => run.track?.author === "李律师" && run.track?.kind === "ins")
        .every((run) => run.track?.id === "2"),
    ).toBe(true);
  });

  it("shrinks someone else's insertion on backspace instead of adding a deletion", () => {
    const zhang = makeAuthorClock("张律师", 3);
    const next = deleteBackward(sample(), 8, 1, zhang);
    expect(inspectRuns(next.runs)).toEqual([
      ["甲方应于", undefined, undefined],
      ["十日", "del", "李律师"],
      ["五", "ins", "李律师"],
      ["付款。", undefined, undefined],
    ]);
  });

  it("turns a replacement of original text into the current lawyer's delete plus insert", () => {
    const zhang = makeAuthorClock("张律师", 3);
    const next = replaceRange(sample(), 8, 10, "结款", zhang);
    expect(inspectRuns(next)).toEqual([
      ["甲方应于", undefined, undefined],
      ["十日", "del", "李律师"],
      ["五日", "ins", "李律师"],
      ["付款", "del", "张律师"],
      ["结款", "ins", "张律师"],
      ["。", undefined, undefined],
    ]);
  });

  it("keeps one color per author, including new marks by the current lawyer", () => {
    const zhang = makeAuthorClock("张律师", 3);
    const next = insertText(sample(), 8, "内", zhang);
    const colors = colorsForRuns(next);
    expect(colors.get("李律师")).toBe(0);
    expect(colors.get("张律师")).toBe(1);
    expect(assignAuthorColors(["李律师", "张律师"]).get("张律师")).toBe(1);
  });

  it("accepts and rejects the way Word rewrites ins/del", () => {
    expect(inspectRuns(decideRuns(sample(), "2", "accept"))).toEqual([
      ["甲方应于", undefined, undefined],
      ["十日", "del", "李律师"],
      ["五日付款。", undefined, undefined],
    ]);
    expect(inspectRuns(decideRuns(sample(), "2", "reject"))).toEqual([
      ["甲方应于", undefined, undefined],
      ["十日", "del", "李律师"],
      ["付款。", undefined, undefined],
    ]);
    expect(inspectRuns(decideRuns(sample(), "1", "accept"))).toEqual([
      ["甲方应于", undefined, undefined],
      ["五日", "ins", "李律师"],
      ["付款。", undefined, undefined],
    ]);
    expect(inspectRuns(decideRuns(sample(), "1", "reject"))).toEqual([
      ["甲方应于十日", undefined, undefined],
      ["五日", "ins", "李律师"],
      ["付款。", undefined, undefined],
    ]);
  });

  it("projects Word display modes", () => {
    expect(
      projectRuns(sample(), "none")
        .map((run) => run.text)
        .join(""),
    ).toBe("甲方应于五日付款。");
    expect(
      projectRuns(sample(), "original")
        .map((run) => run.text)
        .join(""),
    ).toBe("甲方应于十日付款。");
    expect(
      projectRuns(sample(), "all")
        .map((run) => run.text)
        .join(""),
    ).toBe("甲方应于十日五日付款。");
    expect(
      projectRuns(sample(), "all", new Set(["李律师"]))
        .map((run) => run.text)
        .join(""),
    ).toBe("甲方应于五日付款。");
  });

  it("accepting a format mark keeps the new style, rejecting drops it", () => {
    const zhang = makeAuthorClock("张律师", 3);
    const formatted = applyFormatRange(sample(), 0, 4, "加粗", zhang);
    expect(formatted[0]?.track?.kind).toBe("format");
    expect(formatted[0]?.mark?.bold).toBe(true);
    expect(inspectRuns(decideRuns(formatted, formatted[0]?.track?.id ?? "3", "accept"))[0]).toEqual(
      ["甲方应于", undefined, undefined],
    );
    expect(decideRuns(formatted, formatted[0]?.track?.id ?? "3", "accept")[0]?.mark?.bold).toBe(
      true,
    );
    expect(
      decideRuns(formatted, formatted[0]?.track?.id ?? "3", "reject")[0]?.mark?.bold,
    ).toBeUndefined();
  });

  it("lists merged balloons in document order", () => {
    const colors = colorsForRuns(sample());
    expect(collectBalloons(sample(), colors)).toEqual([
      expect.objectContaining({
        revId: "1",
        change: "del",
        author: "李律师",
        text: "十日",
        color: 0,
      }),
      expect.objectContaining({
        revId: "2",
        change: "ins",
        author: "李律师",
        text: "五日",
        color: 0,
      }),
    ]);
  });

  it("materializes a pending hunk as LawMind tracks without recoloring native marks", () => {
    const lawmind = makeAuthorClock("LawMind", maxTrackId(sample()) + 1);
    const painted = materializeHunks(
      [{ text: "甲方应于十日内付款。" }],
      [{ before: "十日", after: "五日" }],
      lawmind,
    );
    expect(inspectRuns(painted)).toEqual([
      ["甲方应于", undefined, undefined],
      ["十", "del", "LawMind"],
      ["五", "ins", "LawMind"],
      ["日内付款。", undefined, undefined],
    ]);
    const skipped = materializeHunks(sample(), [{ before: "十日", after: "五日" }], lawmind);
    expect(inspectRuns(skipped)).toEqual(inspectRuns(sample()));
  });
});
