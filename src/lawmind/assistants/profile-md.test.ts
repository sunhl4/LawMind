import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendAssistantProfileMarkdown,
  assistantProfilePath,
  buildReviewProfileLine,
  listAssistantProfileSections,
  readAssistantProfileMarkdown,
} from "./profile-md.js";

function tmpLawMindRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-prof-"));
}

describe("assistant profile-md", () => {
  it("reads empty when file missing", () => {
    const root = tmpLawMindRoot();
    expect(readAssistantProfileMarkdown(root, "default")).toBe("");
  });

  it("writes and reads PROFILE.md", () => {
    const root = tmpLawMindRoot();
    appendAssistantProfileMarkdown(root, "default", "偏好：结论先写风险。");
    const text = readAssistantProfileMarkdown(root, "default");
    expect(text).toContain("偏好：结论先写风险");
    expect(fs.existsSync(assistantProfilePath(root, "default"))).toBe(true);
  });

  it("rejects invalid assistant id", () => {
    const root = tmpLawMindRoot();
    expect(() => readAssistantProfileMarkdown(root, "../evil")).toThrow("invalid assistant id");
  });
});

describe("listAssistantProfileSections", () => {
  it("lists sections after append with review sourceHint", () => {
    const root = tmpLawMindRoot();
    appendAssistantProfileMarkdown(root, "a1", "手动一行。");
    appendAssistantProfileMarkdown(root, "a1", buildReviewProfileLine("tid", "approved", "note"));
    const sections = listAssistantProfileSections(root, "a1");
    expect(sections.length).toBeGreaterThanOrEqual(2);
    const review = sections.filter((s) => s.sourceHint === "review");
    expect(review.length).toBeGreaterThanOrEqual(1);
    expect(review.some((s) => s.body.includes("草稿审核"))).toBe(true);
  });
});

describe("buildReviewProfileLine", () => {
  it("includes note when present", () => {
    expect(buildReviewProfileLine("t1", "approved", "  ok  ")).toBe(
      "草稿审核（任务 t1，approved）：ok",
    );
  });

  it("omits colon when note empty", () => {
    expect(buildReviewProfileLine("t1", "rejected")).toBe("草稿审核（任务 t1，rejected）。");
  });
});
