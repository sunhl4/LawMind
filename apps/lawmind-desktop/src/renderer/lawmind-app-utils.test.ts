import { describe, expect, it } from "vitest";
import {
  artifactApiRelFromOutput,
  formatLocaleDateTime,
  formatRelativeTime,
  historyBadgeClass,
  legalStatusLabel,
  resolveWorkspacePath,
  taskBadgeClass,
} from "./lawmind-app-utils.ts";

describe("lawmind-app-utils", () => {
  it("resolveWorkspacePath normalizes slashes", () => {
    expect(resolveWorkspacePath("/tmp/ws/", "cases/m1/CASE.md")).toBe("/tmp/ws/cases/m1/CASE.md");
    expect(resolveWorkspacePath("/tmp/ws", "\\drafts\\a.json")).toBe("/tmp/ws/drafts/a.json");
  });

  it("artifactApiRelFromOutput maps artifact paths", () => {
    expect(artifactApiRelFromOutput("artifacts/out.docx")).toBe("artifacts/out.docx");
    expect(artifactApiRelFromOutput("out.docx")).toBe("artifacts/out.docx");
    expect(artifactApiRelFromOutput("other/dir/x")).toBeNull();
    expect(artifactApiRelFromOutput(undefined)).toBeNull();
  });

  it("formatLocaleDateTime falls back on invalid iso", () => {
    expect(formatLocaleDateTime("not-a-date")).toBe("not-a-date");
    expect(formatLocaleDateTime(new Date().toISOString()).length).toBeGreaterThan(0);
  });

  it("formatRelativeTime covers recent buckets", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("刚刚");
    const minsAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(minsAgo)).toContain("分钟前");
    const today = new Date();
    today.setHours(today.getHours() - 1);
    expect(formatRelativeTime(today.toISOString())).toContain("今天");
  });

  it("legalStatusLabel and badge classes", () => {
    expect(legalStatusLabel("running")).toBe("处理中");
    expect(legalStatusLabel("done")).toBe("已完成");
    expect(legalStatusLabel("x", "agent.instruction")).toBe("对话");
    expect(taskBadgeClass("running")).toBe("lm-badge lm-badge-running");
    expect(taskBadgeClass("done")).toBe("lm-badge lm-badge-done");
    expect(taskBadgeClass("weird", "agent.instruction")).toBe("lm-badge lm-badge-chat");
    expect(historyBadgeClass("draft")).toBe("lm-badge lm-badge-draft");
    expect(historyBadgeClass("task", "agent.instruction")).toBe("lm-badge lm-badge-chat");
    expect(historyBadgeClass("task", undefined, "failed")).toBe("lm-badge lm-badge-error");
  });
});
