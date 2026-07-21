import { describe, expect, it } from "vitest";
import { runTriageRules } from "./rules.js";

describe("runTriageRules", () => {
  it("marks empty input red", () => {
    const r = runTriageRules({ text: "   " });
    expect(r.tier).toBe("red");
    expect(r.matchedRuleIds).toContain("empty-input");
  });

  it("triages NDA as yellow", () => {
    const r = runTriageRules({
      text: "请审查这份互惠保密协议 NDA",
      deliverableTypeHint: "contract.nda",
    });
    expect(r.tier).toBe("yellow");
    expect(r.matchedRuleIds.some((id) => id.includes("nda"))).toBe(true);
    expect(r.clarifications.some((c) => c.key === "stance")).toBe(true);
  });

  it("triages litigation as red", () => {
    const r = runTriageRules({ text: "下周开庭，请准备代理词与证据清单" });
    expect(r.tier).toBe("red");
    expect(r.clarifications.some((c) => c.required)).toBe(true);
  });

  it("allows short general brief as green", () => {
    const r = runTriageRules({ text: "帮我整理一份客户会议纪要摘要" });
    expect(r.tier).toBe("green");
  });
});
