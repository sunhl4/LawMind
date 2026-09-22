import { describe, expect, it } from "vitest";
import {
  formatChineseInteger,
  parseChineseDecimal,
  parseChineseInteger,
} from "./chinese-numeral.js";

describe("chinese-numeral", () => {
  it("parses integers with 十/百 units", () => {
    expect(parseChineseInteger("五")).toBe(5);
    expect(parseChineseInteger("十")).toBe(10);
    expect(parseChineseInteger("十五")).toBe(15);
    expect(parseChineseInteger("三十")).toBe(30);
    expect(parseChineseInteger("二十五")).toBe(25);
    expect(parseChineseInteger("一百二十")).toBe(120);
    expect(parseChineseInteger("两")).toBe(2);
  });

  it("parses decimals with 点", () => {
    expect(parseChineseDecimal("二十五点五")).toBe(25.5);
    expect(parseChineseDecimal("三十")).toBe(30);
    expect(parseChineseDecimal("五点二五")).toBeCloseTo(5.25);
  });

  it("passes through Arabic numerals and rejects garbage", () => {
    expect(parseChineseDecimal("25.5")).toBe(25.5);
    expect(parseChineseInteger("120")).toBe(120);
    expect(Number.isNaN(parseChineseDecimal("若干"))).toBe(true);
    expect(Number.isNaN(parseChineseInteger(""))).toBe(true);
  });

  it("formats 0–99 integers for suggestion hunks", () => {
    expect(formatChineseInteger(20)).toBe("二十");
    expect(formatChineseInteger(15)).toBe("十五");
    expect(formatChineseInteger(6)).toBe("六");
    expect(formatChineseInteger(10)).toBe("十");
  });
});
