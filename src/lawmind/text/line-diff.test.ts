import { describe, expect, it } from "vitest";
import { diffLines } from "./line-diff.js";

describe("diffLines", () => {
  it("reports add and remove hunks", () => {
    const { hunks } = diffLines("a\nb", "a\nc");
    const types = hunks.map((h) => h.type);
    expect(types).toContain("equal");
    expect(types).toContain("remove");
    expect(types).toContain("add");
  });

  it("returns single equal hunk when identical", () => {
    const { hunks } = diffLines("same", "same");
    expect(hunks).toEqual([{ type: "equal", lines: ["same"] }]);
  });
});
