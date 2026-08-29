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

  it("provides review intake defaults with stance/depth chips口径", () => {
    const fields = defaultIntakeFieldsForDeliverable("contract.review");
    expect(fields.some((f) => f.key === "focus" && f.required)).toBe(true);
    const stance = fields.find((f) => f.key === "stance");
    expect(stance?.placeholder).toContain("委托方");
    expect(stance?.placeholder).toContain("相对方");
    expect(fields.some((f) => f.key === "depth" && f.required)).toBe(true);
  });

  it("primes research gates in dispatch prompts", () => {
    const compliance = buildJobIntakeDispatchPrompt({
      templateName: "合规研究",
      deliverableType: "report.compliance",
      fields: [{ key: "topic", label: "监管问题", value: "数据出境" }],
    });
    expect(compliance).toMatch(/大纲/);
    expect(compliance).toMatch(/VERIFY|管辖/);

    const training = buildJobIntakeDispatchPrompt({
      templateName: "培训",
      deliverableType: "ppt.training",
      fields: [
        { key: "topic", label: "培训主题", value: "出口管制" },
        { key: "desense", label: "脱敏声明", value: "已脱敏" },
      ],
    });
    expect(training).toMatch(/脱敏/);
    expect(defaultIntakeFieldsForDeliverable("ppt.training").some((f) => f.key === "desense")).toBe(
      true,
    );
    expect(
      defaultIntakeFieldsForDeliverable("report.learning").some((f) => f.key === "authority_levels"),
    ).toBe(true);
  });
});
