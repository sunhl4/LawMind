import { describe, expect, it } from "vitest";
import { extractHabitsFromRedlines } from "./habit-extract.js";

function hunk(after: string, status = "accepted") {
  return { before: "提交有管辖权的人民法院", after, status, heading: "争议解决" };
}

describe("extractHabitsFromRedlines", () => {
  it("queues clause types with ≥5 accepts and keeps the latest wording on conflict", () => {
    const older = {
      path: "drafts/a.redline.json",
      mtimeMs: 1_000,
      hunks: Array.from({ length: 3 }, () => hunk("提交上海仲裁委员会仲裁")),
    };
    const newer = {
      path: "drafts/b.redline.json",
      mtimeMs: 9_000,
      hunks: [hunk("提交北京仲裁委员会仲裁"), hunk("提交北京仲裁委员会仲裁")],
    };
    const habits = extractHabitsFromRedlines([older, newer]);
    expect(habits).toHaveLength(1);
    expect(habits[0]?.occurrences).toBe(5);
    expect(habits[0]?.preferredLanguage).toContain("北京仲裁委员会");
  });

  it("does not queue below five occurrences", () => {
    const file = {
      path: "drafts/c.redline.json",
      mtimeMs: 1,
      hunks: Array.from({ length: 4 }, () => hunk("提交上海仲裁委员会仲裁")),
    };
    expect(extractHabitsFromRedlines([file])).toEqual([]);
  });
});
