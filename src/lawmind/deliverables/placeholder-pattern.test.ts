import { describe, expect, it } from "vitest";
import {
  countScaffoldPlaceholdersInDraft,
  findScaffoldPlaceholders,
  isHighScaffoldDensity,
  isScaffoldFieldLabel,
} from "./placeholder-pattern.js";

describe("placeholder-pattern", () => {
  it("treats explicit 待补充 and known scaffold labels as placeholders", () => {
    const text = "致：【收函对象】\n请于【待补充：履行期限】前履行。引用【法释〔2023〕1号】。";
    const found = findScaffoldPlaceholders(text);
    expect(found.some((s) => s.includes("收函对象"))).toBe(true);
    expect(found.some((s) => s.includes("待补充"))).toBe(true);
    expect(found.some((s) => s.includes("法释"))).toBe(false);
  });

  it("does not treat statute-like brackets as scaffold labels", () => {
    expect(isScaffoldFieldLabel("法释〔2023〕1号")).toBe(false);
    expect(isScaffoldFieldLabel("收函对象")).toBe(true);
  });

  it("marks high density when three or more scaffold tokens exist", () => {
    const samples = countScaffoldPlaceholdersInDraft([
      { heading: "收函人", body: "致：【收函对象】" },
      { heading: "事实", body: "【事实经过】与【委托人名称】" },
    ]);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(isHighScaffoldDensity(samples, 80)).toBe(true);
  });
});
