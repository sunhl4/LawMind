import { describe, expect, it } from "vitest";
import { cellStyleToCss, columnLetters } from "./xlsx-preview-style";

describe("xlsx-preview-style", () => {
  it("maps Excel column indexes to letters", () => {
    expect(columnLetters(0)).toBe("A");
    expect(columnLetters(25)).toBe("Z");
    expect(columnLetters(26)).toBe("AA");
  });

  it("maps medium borders and fills to CSS", () => {
    const css = cellStyleToCss({
      bg: "#d9ead3",
      bold: true,
      hAlign: "center",
      vAlign: "middle",
      border: {
        t: { style: "medium", color: "#000000" },
        r: { style: "thin" },
        b: { style: "medium" },
        l: { style: "medium" },
      },
    });
    expect(css.backgroundColor).toBe("#d9ead3");
    expect(css.fontWeight).toBe(700);
    expect(css.textAlign).toBe("center");
    expect(css.borderTop).toBe("2px solid #000000");
    expect(css.borderRight).toBe("1px solid #000000");
  });
});
