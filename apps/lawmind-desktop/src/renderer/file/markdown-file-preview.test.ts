import { describe, expect, it } from "vitest";
import { isMarkdownWorkbenchPath } from "./markdown-file-preview";

describe("isMarkdownWorkbenchPath", () => {
  it("recognizes common markdown names", () => {
    expect(isMarkdownWorkbenchPath("CASE.md")).toBe(true);
    expect(isMarkdownWorkbenchPath("cases/a/notes.markdown")).toBe(true);
    expect(isMarkdownWorkbenchPath("readme.mdx")).toBe(true);
  });

  it("excludes canvas and plain text", () => {
    expect(isMarkdownWorkbenchPath("board.canvas.tsx")).toBe(false);
    expect(isMarkdownWorkbenchPath("notes.txt")).toBe(false);
    expect(isMarkdownWorkbenchPath("code.ts")).toBe(false);
  });
});
