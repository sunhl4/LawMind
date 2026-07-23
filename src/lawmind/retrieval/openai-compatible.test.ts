import { describe, expect, it } from "vitest";
import { fallbackRetrievalFromNonJson } from "./openai-compatible.js";

describe("fallbackRetrievalFromNonJson", () => {
  it("salvages markdown prose as a low-confidence claim", () => {
    const out = fallbackRetrievalFromNonJson(
      "## 检索摘要\n\n根据《民法典》第509条，当事人应按约履行。",
    );
    expect(out.claims.length).toBe(1);
    expect(out.claims[0]?.text).toContain("民法典");
    expect(out.claims[0]?.confidence).toBeLessThan(0.5);
    expect(out.riskFlags.some((r) => r.includes("降级"))).toBe(true);
  });

  it("returns empty when content is blank", () => {
    const out = fallbackRetrievalFromNonJson("   ");
    expect(out.claims).toEqual([]);
  });
});
