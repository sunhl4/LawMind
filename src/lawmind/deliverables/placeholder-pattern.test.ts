import { describe, expect, it } from "vitest";
import {
  findScaffoldPlaceholders,
  isHighScaffoldDensity,
  isScaffoldFieldLabel,
} from "./placeholder-pattern.js";

describe("placeholder-pattern scaffold honesty", () => {
  it("does not treat a legal-citation bracket as a scaffold field", () => {
    expect(isScaffoldFieldLabel("法释〔2023〕1号")).toBe(false);
    expect(findScaffoldPlaceholders("依据【法释〔2023〕1号】处理。")).toEqual([]);
  });

  it("recognizes keyword-draft field labels and explicit todos", () => {
    expect(findScaffoldPlaceholders("【出租人】与【待补充：押金】")).toEqual([
      "【待补充：押金】",
      "【出租人】",
    ]);
  });

  it("treats three scaffold tokens as dense", () => {
    expect(isHighScaffoldDensity(["【出租人】", "【承租人】", "【房屋地址】"], 40)).toBe(true);
    expect(isHighScaffoldDensity(["【待补充：押金】"], 800)).toBe(false);
  });
});
