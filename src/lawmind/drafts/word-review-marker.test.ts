import { describe, expect, it } from "vitest";
import { reviewFileRel, splitWordCheckMarkers, wordCheckMarker } from "./word-review-marker.js";

describe("word check marker", () => {
  it("keeps the review file beside 去核对", () => {
    const mark = wordCheckMarker("task-9", "非技术相关/合同_20260928_01.docx");
    expect(mark).toBe("[[word-check:task-9|非技术相关/合同_20260928_01.docx]]");
    const split = splitWordCheckMarkers(`写好了。\n\n${mark}`);
    expect(split.body).toBe("写好了。");
    expect(split.checks).toEqual([
      { taskId: "task-9", relPath: "非技术相关/合同_20260928_01.docx" },
    ]);
  });

  it("places the review copy next to the original", () => {
    expect(
      reviewFileRel(
        "非技术相关/通用采购合同.docx",
        "/Users/shl/nvidia/YX/非技术相关/通用采购合同_20260928_01.docx",
      ),
    ).toBe("非技术相关/通用采购合同_20260928_01.docx");
  });

  it("drops a path that leaves the workspace", () => {
    expect(wordCheckMarker("task-9", "../secret.docx")).toBe("[[word-check:task-9]]");
    expect(splitWordCheckMarkers("[[word-check:task-9]]").checks).toEqual([{ taskId: "task-9" }]);
  });
});
