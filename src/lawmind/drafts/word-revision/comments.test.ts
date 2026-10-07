import { describe, expect, it } from "vitest";
import { parseCommentsXml, serializeCommentsXml } from "./comments.ts";

describe("Word comments.xml", () => {
  it("round-trips author, date, and body", () => {
    const xml = serializeCommentsXml([
      {
        commentId: "1",
        author: "李律师",
        date: "2026-10-07T00:00:00Z",
        body: "看这里",
        anchorText: "五日",
      },
    ]);
    expect(xml).toContain('w:id="1"');
    expect(xml).toContain('w:author="李律师"');
    expect(parseCommentsXml(xml)).toEqual([
      expect.objectContaining({ commentId: "1", author: "李律师", body: "看这里" }),
    ]);
  });
});
