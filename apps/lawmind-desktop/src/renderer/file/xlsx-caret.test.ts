import { describe, expect, it } from "vitest";
import { caretIndexFromTextWidth } from "./xlsx-caret";

describe("caretIndexFromTextWidth", () => {
  const widths: Record<string, number> = {
    "": 0,
    a: 10,
    ab: 20,
    abc: 30,
    abcd: 40,
  };
  const measure = (text: string) => widths[text] ?? text.length * 10;

  it("puts caret at click position without selecting all", () => {
    expect(caretIndexFromTextWidth("abcd", -1, measure)).toBe(0);
    expect(caretIndexFromTextWidth("abcd", 0, measure)).toBe(0);
    expect(caretIndexFromTextWidth("abcd", 15, measure)).toBe(1);
    expect(caretIndexFromTextWidth("abcd", 25, measure)).toBe(2);
    expect(caretIndexFromTextWidth("abcd", 100, measure)).toBe(4);
  });
});
