import { describe, expect, it } from "vitest";
import { truncateForPrompt, windowCaseMarkdownForPrompt } from "./prompt-windows.js";

describe("prompt-windows", () => {
  it("truncateForPrompt keeps head and tail", () => {
    const raw = `${"A".repeat(100)}MID${"B".repeat(100)}`;
    const out = truncateForPrompt(raw, 80);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.startsWith("A")).toBe(true);
    expect(out.endsWith("B")).toBe(true);
    expect(out).toContain("截断");
  });

  it("windowCaseMarkdownForPrompt trims long progress section", () => {
    const bullets = Array.from({ length: 40 }, (_, i) => `- [${i}] progress ${i}`).join("\n");
    const raw = `# 案\n\n## 1. 基本信息\n\n- matterId: m1\n\n## 8. 工作进展记录\n\n${bullets}\n\n## 9. 生成产物\n\n- doc\n`;
    const out = windowCaseMarkdownForPrompt(raw, 2000);
    expect(out).toContain("## 1. 基本信息");
    expect(out).toContain("## 9. 生成产物");
    expect(out).toContain("已省略");
    expect(out).toContain("progress 39");
    expect(out).not.toContain("progress 0");
  });
});
