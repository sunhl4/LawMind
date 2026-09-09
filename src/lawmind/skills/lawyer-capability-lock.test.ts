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
    expect(labels).toContain("法律快问");
    expect(labels).toContain("劳动计算");
    expect(labels).toContain("期限计算");
    expect(labels).toContain("整理发票");
    expect(labels).toContain("法院短信");
    expect(labels).toContain("知产争议");
    expect(labels).toContain("并购尽调");
    expect(labels).toContain("数据合规");
    expect(labels).toContain("办案周报");
    expect(labels).toContain("家事继承");
    expect(labels).toContain("资本市场");
    expect(labels).toContain("公司治理");
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
