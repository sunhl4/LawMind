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
});
