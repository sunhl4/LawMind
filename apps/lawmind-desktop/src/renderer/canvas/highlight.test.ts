import { describe, expect, it } from "vitest";
import { highlightLine, languageFromPath } from "./highlight";

describe("highlightLine", () => {
  it("colors keywords, strings, and numbers", () => {
    const kinds = highlightLine('const n = 12; // note', "ts").map((token) => token.kind);
    expect(kinds).toContain("keyword");
    expect(kinds).toContain("number");
    expect(kinds).toContain("comment");
    expect(kinds).toContain("punct");
    expect(highlightLine("type Claim = string", "ts").some((token) => token.kind === "type" && token.text === "Claim")).toBe(
      true,
    );
    expect(highlightLine("class Box { #id = 1 }", "ts").some((token) => token.text.includes("#id") && token.kind === "comment")).toBe(
      false,
    );
    expect(highlightLine("# note", "py").some((token) => token.kind === "comment")).toBe(true);
  });

  it("reads the language from a file extension", () => {
    expect(languageFromPath("src/app.py", undefined)).toBe("py");
    expect(highlightLine("def run():", "py").some((token) => token.kind === "keyword" && token.text === "def")).toBe(
      true,
    );
  });
});
