import { describe, expect, it } from "vitest";
import {
  extractAppliedPreferencesFromProfile,
  formatAppliedPreferencesHint,
} from "./applied-preferences.js";

describe("applied-preferences", () => {
  it("extracts newest bullets from section 八", () => {
    const md = `# 律师档案

## 一、基本信息
foo

## 八、个人积累
- 2026-01-01：旧偏好甲
- 冷启动偏好：行文风格=简洁直接
- 冷启动偏好：风险口径=偏保守

## 九、其他
bar
`;
    const prefs = extractAppliedPreferencesFromProfile(md, 5);
    expect(prefs.length).toBe(3);
    expect(prefs[0]?.text).toContain("偏保守");
    expect(formatAppliedPreferencesHint(prefs)).toContain("已按你的习惯");
  });

  it("skips stock 学习队列 / 审核标签 instructional bullets", () => {
    const md = `## 八、个人积累

- **学习队列（稍后采纳）**：审核结论可以先进入队列，再单独「采纳」后写入长期记忆；避免一次审核就自动改掉助手/Playbook 里的偏好。
- **审核标签（可选）**：用固定标签把问题分类，便于质量学习与后续统计；不选标签也能完成审核。
- [2026-09-12] 争议解决写北京仲裁委员会
`;
    const prefs = extractAppliedPreferencesFromProfile(md, 5);
    expect(prefs).toHaveLength(1);
    expect(prefs[0]?.text).toContain("北京仲裁委员会");
  });
});
