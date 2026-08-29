import { describe, expect, it } from "vitest";
import {
  formatCapabilityDispatchPrompt,
  LAWYER_CAPABILITY_DESK_ITEMS,
  parseCapabilityLock,
} from "./lawyer-capability-lock.js";

describe("lawyer-capability-lock", () => {
  it("lists desk processes without activation slang", () => {
    const labels = LAWYER_CAPABILITY_DESK_ITEMS.map((i) => i.label);
    expect(labels).toContain("合同审查");
    expect(labels).toContain("函件起草");
    expect(labels).not.toContain("审这份");
    expect(labels).not.toContain("写这封");
  });

  it("round-trips a lock so the lawyer does not type keywords", () => {
    const prompt = formatCapabilityDispatchPrompt({
      id: "contract.review",
      label: "合同审查",
    });
    expect(prompt).toContain("【办件】能力：contract.review");
    expect(parseCapabilityLock(prompt)).toBe("contract.review");
    expect(parseCapabilityLock("请审查这份采购合同")).toBeUndefined();
  });
});
