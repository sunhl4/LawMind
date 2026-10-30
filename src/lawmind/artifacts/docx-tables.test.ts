/**
 * Markdown 管道表格解析：只认完整表格，顺序与正文保持一致。
 */

import { describe, expect, it } from "vitest";
import { splitMarkdownTableBlocks } from "./docx-tables.js";

describe("splitMarkdownTableBlocks", () => {
  it("keeps text and table blocks in order", () => {
    const blocks = splitMarkdownTableBlocks(
      [
        "先说明：",
        "",
        "| 项目 | 金额 |",
        "| --- | ---: |",
        "| 律师费 | 5000 |",
        "| 差旅 | 实报 |",
        "",
        "表后说明。",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { kind: "text", text: "先说明：" },
      {
        kind: "table",
        header: ["项目", "金额"],
        rows: [
          ["律师费", "5000"],
          ["差旅", "实报"],
        ],
      },
      { kind: "text", text: "表后说明。" },
    ]);
  });

  it("leaves pipe text without a separator as ordinary paragraphs", () => {
    const blocks = splitMarkdownTableBlocks("甲方 | 乙方\n不构成表格");
    expect(blocks).toEqual([{ kind: "text", text: "甲方 | 乙方\n不构成表格" }]);
  });

  it("requires at least three dashes in the separator", () => {
    const blocks = splitMarkdownTableBlocks("| a | b |\n| -- | -- |\n| 1 | 2 |");
    expect(blocks).toEqual([{ kind: "text", text: "| a | b |\n| -- | -- |\n| 1 | 2 |" }]);
  });

  it("handles a table without surrounding text", () => {
    const blocks = splitMarkdownTableBlocks("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "table", header: ["a", "b"] });
  });

  it("returns nothing for blank bodies", () => {
    expect(splitMarkdownTableBlocks("   \n\n")).toEqual([]);
  });
});
