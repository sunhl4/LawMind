import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderPptx } from "./render-pptx.js";
import type { ArtifactDraft } from "../types.js";

function minimalDraft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    title: "Test PPT",
    output: "pptx",
    templateId: "ppt/client-brief-default",
    summary: "摘要一行",
    sections: [
      { heading: "第一节", body: "正文A\n正文B" },
      { heading: "第二节", body: "带引用", citations: ["src-1"] },
    ],
    reviewNotes: [],
    reviewStatus: "approved",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("renderPptx", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-pptx-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects when not approved", async () => {
    const draft = minimalDraft({ reviewStatus: "pending" });
    const result = await renderPptx(draft, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("未通过审核");
  });

  it("writes a .pptx file when approved", async () => {
    const draft = minimalDraft();
    const result = await renderPptx(draft, tmpDir);
    expect(result.ok).toBe(true);
    expect(result.outputPath).toMatch(/\.pptx$/);
    const stat = await fs.stat(result.outputPath!);
    expect(stat.size).toBeGreaterThan(2000);
  });
});
