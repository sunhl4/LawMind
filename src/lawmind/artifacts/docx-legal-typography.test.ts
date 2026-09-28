import { describe, expect, it } from "vitest";
import { classifyChineseHeadingLevel } from "./docx-legal-typography.js";

describe("classifyChineseHeadingLevel", () => {
  it("recognizes Chinese memo heading levels", () => {
    expect(classifyChineseHeadingLevel("一、结论")).toBe(1);
    expect(classifyChineseHeadingLevel("（一）争点一")).toBe(2);
    expect(classifyChineseHeadingLevel("1、规范依据")).toBe(3);
    expect(classifyChineseHeadingLevel("免责声明")).toBe(1);
  });

  it("rejects AI-style or western section numbers", () => {
    expect(classifyChineseHeadingLevel("0. 检索/研究策略")).toBeNull();
    expect(classifyChineseHeadingLevel("2.1 法规清单")).toBeNull();
    expect(classifyChineseHeadingLevel("§1.1 定义")).toBeNull();
  });
});
