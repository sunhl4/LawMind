import { describe, expect, it } from "vitest";
import { isValidMatterId, parseOptionalMatterId } from "./matter-id.js";

describe("matter-id", () => {
  it("accepts typical ids", () => {
    expect(isValidMatterId("matter-001")).toBe(true);
    expect(isValidMatterId("M2026_abc")).toBe(true);
  });

  it("rejects empty and traversal", () => {
    expect(isValidMatterId("")).toBe(false);
    expect(isValidMatterId("../x")).toBe(false);
    expect(isValidMatterId("a")).toBe(false);
  });

  it("parseOptionalMatterId returns undefined for absent", () => {
    expect(parseOptionalMatterId(undefined)).toBeUndefined();
    expect(parseOptionalMatterId("")).toBeUndefined();
    expect(parseOptionalMatterId("  ")).toBeUndefined();
  });

  it("parseOptionalMatterId returns id when valid", () => {
    expect(parseOptionalMatterId("  case-01  ")).toBe("case-01");
  });

  it("parseOptionalMatterId throws on invalid", () => {
    expect(() => parseOptionalMatterId("..")).toThrow("invalid_matter_id");
  });
});
