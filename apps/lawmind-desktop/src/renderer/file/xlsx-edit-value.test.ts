import { describe, expect, it } from "vitest";
import { formatXlsxEditValue, parseXlsxEditInput } from "./xlsx-edit-value";

describe("xlsx-edit-value", () => {
  it("parses numbers, booleans, and blank", () => {
    expect(parseXlsxEditInput("")).toBeNull();
    expect(parseXlsxEditInput("  ")).toBeNull();
    expect(parseXlsxEditInput("12.5")).toBe(12.5);
    expect(parseXlsxEditInput("TRUE")).toBe(true);
    expect(parseXlsxEditInput("条款A")).toBe("条款A");
  });

  it("formats for the in-cell editor", () => {
    expect(formatXlsxEditValue(null)).toBe("");
    expect(formatXlsxEditValue(true)).toBe("TRUE");
    expect(formatXlsxEditValue(3)).toBe("3");
  });
});
