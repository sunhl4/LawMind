import { describe, expect, it } from "vitest";
import { suggestPlaceholderFieldPaths } from "./draft-template-values.js";

describe("suggestPlaceholderFieldPaths", () => {
  it("maps simple names to draft field paths", () => {
    expect(
      suggestPlaceholderFieldPaths(["title", "summary", "matterId", "sections_0_body"]),
    ).toEqual({
      title: "title",
      summary: "summary",
      matterId: "matterId",
      sections_0_body: "sections.0.body",
    });
  });

  it("maps aliases and section headers", () => {
    expect(
      suggestPlaceholderFieldPaths(["review_notes", "Matter_ID", "sections_1_heading"]),
    ).toEqual({
      review_notes: "reviewNotes",
      Matter_ID: "matterId",
      sections_1_heading: "sections.1.heading",
    });
  });
});
