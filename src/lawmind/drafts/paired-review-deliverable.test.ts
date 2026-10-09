import { describe, expect, it } from "vitest";
import { pinsIncludeWordFile, wordFilePinRelPaths } from "./paired-review-deliverable.js";

describe("word file pins", () => {
  const docxPin = {
    pinKind: "file" as const,
    root: "project" as const,
    relPath: "采购合同.docx",
    kind: "file" as const,
  };

  it("lists pinned word paths and ignores other files", () => {
    expect(pinsIncludeWordFile([docxPin])).toBe(true);
    expect(pinsIncludeWordFile([])).toBe(false);
    expect(
      pinsIncludeWordFile([
        {
          pinKind: "file",
          root: "project",
          relPath: "隔断采购合同.pdf",
          kind: "file",
        },
      ]),
    ).toBe(false);
    expect(wordFilePinRelPaths([docxPin])).toEqual(["采购合同.docx"]);
  });
});
