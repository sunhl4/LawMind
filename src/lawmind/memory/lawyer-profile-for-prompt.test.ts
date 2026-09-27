import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  lawyerProfileForPrompt,
  windowLawyerProfileForPrompt,
} from "./lawyer-profile-for-prompt.js";

const STOCK_TEMPLATE = `# LAWYER_PROFILE.md — 律师个人偏好记忆

- **姓名**：
- **称呼**：
- **结构方式**：_（例：结论前置、IRAC 框架、分条列项）_
`;

const REPO_TEMPLATE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../workspace/LAWYER_PROFILE.md"),
  "utf8",
);

describe("lawyerProfileForPrompt", () => {
  it("drops the empty stock template", () => {
    expect(lawyerProfileForPrompt(STOCK_TEMPLATE)).toBeUndefined();
    expect(lawyerProfileForPrompt("# Lawyer profile")).toBeUndefined();
    expect(lawyerProfileForPrompt("")).toBeUndefined();
    expect(lawyerProfileForPrompt(REPO_TEMPLATE)).toBeUndefined();
  });

  it("keeps a filled profile", () => {
    const filled = `${STOCK_TEMPLATE}\n- **姓名**：张三\n`;
    expect(lawyerProfileForPrompt(filled)).toContain("张三");
  });

  it("keeps section 八 when it has real product notes", () => {
    const onlyEight = `# LAWYER_PROFILE.md

## 八、个人积累

- **审核标签（可选）**：语气过强，引用有误。
`;
    expect(lawyerProfileForPrompt(onlyEight)).toContain("审核标签");
  });

  it("keeps dated learning bullets in section 八", () => {
    const dated = `# LAWYER_PROFILE.md

## 八、个人积累

- [2026-09-12] [source:review] 草稿审核学习（任务 t1，approved）：语气过强。
`;
    expect(lawyerProfileForPrompt(dated)).toContain("草稿审核学习");
  });
});

describe("windowLawyerProfileForPrompt", () => {
  it("keeps identity and the newest section-eight bullets inside the cap", () => {
    const oldBullets = Array.from(
      { length: 12 },
      (_, i) => `- [2026-01-${String(i + 1).padStart(2, "0")}] 旧习惯 ${i} 付款期限写法`,
    );
    const profile = [
      "# LAWYER_PROFILE.md",
      "- **姓名**：张三",
      "- **所在机构**：___",
      "## 八、个人积累",
      ...oldBullets,
      "- [2026-09-20] 最新：责任上限写成已付费用，不含间接损失。",
    ].join("\n");
    const windowed = windowLawyerProfileForPrompt(profile, 280);
    expect(windowed).toContain("张三");
    expect(windowed).toContain("最新：责任上限");
    expect(windowed).not.toContain("旧习惯 0");
    expect(windowed).toContain("已省略");
    expect(windowed.length).toBeLessThanOrEqual(280);
  });

  it("prefers the bullet that overlaps this turn when the window cannot hold every habit", () => {
    const filler = Array.from(
      { length: 8 },
      (_, i) => `- [2026-08-${String(i + 1).padStart(2, "0")}] 语气保持克制，不用责问句 ${i}`,
    );
    const profile = [
      "# LAWYER_PROFILE.md",
      "- **姓名**：张三",
      "## 八、个人积累",
      "- [2026-03-01] 付款期限写成收到发票后四十五日，不写三十日。",
      ...filler,
      "- [2026-09-20] 函件抬头用全称，不缩写。",
    ].join("\n");
    const windowed = windowLawyerProfileForPrompt(profile, 220, "这份合同的付款期限怎么写");
    expect(windowed).toContain("付款期限");
    expect(windowed).not.toContain("函件抬头");
    expect(windowed).toContain("关系较弱");
    expect(windowed.length).toBeLessThanOrEqual(220);
  });

  it("falls back to the newest bullets when the question overlaps nothing", () => {
    const filler = Array.from(
      { length: 6 },
      (_, i) => `- [2026-08-0${i + 1}] 语气保持克制，不用责问句 ${i}`,
    );
    const profile = [
      "# LAWYER_PROFILE.md",
      "- **姓名**：张三",
      "## 八、个人积累",
      "- [2026-03-01] 付款期限写成收到发票后四十五日。",
      ...filler,
      "- [2026-09-20] 函件抬头用全称，不缩写。",
    ].join("\n");
    const windowed = windowLawyerProfileForPrompt(profile, 200, "今天天气如何");
    expect(windowed).toContain("函件抬头");
    expect(windowed).not.toContain("付款期限");
    expect(windowed).toContain("更早");
  });
});
