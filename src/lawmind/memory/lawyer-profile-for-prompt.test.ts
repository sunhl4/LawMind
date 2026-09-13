import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lawyerProfileForPrompt } from "./lawyer-profile-for-prompt.js";

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
