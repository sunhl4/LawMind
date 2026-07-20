import { describe, expect, it } from "vitest";
import {
  buildJobIntakeDispatchPrompt,
  defaultIntakeFieldsForDeliverable,
} from "./lawmind-job-intake";

describe("lawmind-job-intake", () => {
  it("builds a filled-intake marker prompt", () => {
    const prompt = buildJobIntakeDispatchPrompt({
      templateName: "合同审查意见",
      deliverableType: "contract.review",
      fields: [
        { key: "focus", label: "审查重点", value: "付款" },
        { key: "stance", label: "己方立场", value: "乙方" },
      ],
    });
    expect(prompt).toContain("【交办】");
    expect(prompt).toContain("交付物类型：合同审查意见");
    expect(prompt).toContain("付款");
  });

  it("provides review intake defaults", () => {
    const fields = defaultIntakeFieldsForDeliverable("contract.review");
    expect(fields.some((f) => f.key === "focus" && f.required)).toBe(true);
  });
});
