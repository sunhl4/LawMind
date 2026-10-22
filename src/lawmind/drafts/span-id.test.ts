import { describe, expect, it } from "vitest";
import { contentHashOf, deriveSpanId, deriveSpanIds } from "./span-id.js";

describe("deriveSpanId", () => {
  it("prefers w14:paraId when present", () => {
    expect(deriveSpanId({ paraId: "036DE1E2", paragraphIndex: 3, text: "甲方" })).toBe(
      "pid:036DE1E2",
    );
  });

  it("falls back to ordinal + content hash, stable for identical text", () => {
    const a = deriveSpanId({ paragraphIndex: 2, text: "违约责任" });
    const b = deriveSpanId({ paragraphIndex: 2, text: "违约责任" });
    expect(a).toBe(b);
    expect(a).toContain(contentHashOf("违约责任"));
  });

  it("differs when ordinal differs even for identical text", () => {
    const a = deriveSpanId({ paragraphIndex: 1, text: "同句" });
    const b = deriveSpanId({ paragraphIndex: 2, text: "同句" });
    expect(a).not.toBe(b);
  });

  it("disambiguates duplicate paraIds deterministically", () => {
    const ids = deriveSpanIds([
      { paraId: "AAA", paragraphIndex: 0, text: "一" },
      { paraId: "AAA", paragraphIndex: 1, text: "二" },
    ]);
    expect(ids).toEqual(["pid:AAA", "pid:AAA#1"]);
  });
});
