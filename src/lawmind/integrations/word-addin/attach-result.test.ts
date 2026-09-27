import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RedlineHunk } from "../../drafts/redline-proposal.js";
import { attachWordAddinResultForSource } from "./attach-result.js";
import {
  createWordAddinReview,
  listWordAddinReviews,
  readWordAddinReview,
  WORD_ADDIN_STORE_REL,
} from "./review-requests.js";

const surgical: RedlineHunk = {
  hunkId: "h1",
  sectionIndex: 0,
  before: "十日内",
  after: "五个工作日内",
  status: "pending",
  granularity: "surgical",
};
const sectionRewrite: RedlineHunk = {
  hunkId: "h2",
  sectionIndex: 1,
  // 真换整节：两段没有任何共有片段，重算后仍是一处 60 字以上的改动 → 不上插件。
  before: "甲".repeat(80),
  after: "乙".repeat(80),
  status: "pending",
  granularity: "section",
};

describe("attachWordAddinResultForSource", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-word-addin-attach-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("does nothing when there is no Word add-in request", async () => {
    const result = await attachWordAddinResultForSource({
      workspaceDir,
      sourceAbs: "/tmp/某案/合同.docx",
      outputPath: "/tmp/某案/合同_01.docx",
      hunks: [surgical],
    });
    expect(result.attached).toEqual([]);
    // 无插件时连存储文件都不该生成：桌面路径完全不受影响。
    await expect(fs.access(path.join(workspaceDir, WORD_ADDIN_STORE_REL))).rejects.toThrow();
  });

  it("fills the matching request with the produced file and surgical anchors", async () => {
    const created = await createWordAddinReview(workspaceDir, {
      sourcePath: "/tmp/某案/合同.docx",
    });
    if (!created.ok) {
      throw new Error("seed failed");
    }

    const result = await attachWordAddinResultForSource({
      workspaceDir,
      sourceAbs: "/tmp/某案/合同.docx",
      outputPath: "/tmp/某案/合同_2026-09-20_01.docx",
      hunks: [surgical, sectionRewrite],
      summary: "合作协议审查",
    });
    expect(result.attached).toEqual([created.request.id]);

    const row = readWordAddinReview(workspaceDir, created.request.id);
    expect(row?.state).toBe("ready");
    expect(row?.outputPath).toBe("/tmp/某案/合同_2026-09-20_01.docx");
    // 最短改动：「十日内→五个工作日内」里共有的「日内」留在修订轨之外。
    expect(row?.hunks).toEqual([{ find: "十", replace: "五个工作", hunkId: "h1" }]);
    expect(row?.skippedSectionHunks).toBe(1);
    expect(row?.summary).toBe("合作协议审查");
  });

  it("skips requests for other files", async () => {
    await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/另一案/保密协议.docx" });
    const result = await attachWordAddinResultForSource({
      workspaceDir,
      sourceAbs: "/tmp/某案/合同.docx",
      outputPath: "/tmp/某案/合同_01.docx",
      hunks: [surgical],
    });
    expect(result.attached).toEqual([]);
    expect(listWordAddinReviews(workspaceDir, { state: "ready" })).toHaveLength(0);
  });

  it("marks ready with no anchors when only whole-section rewrites exist", async () => {
    const created = await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/整节.docx" });
    if (!created.ok) {
      throw new Error("seed failed");
    }
    const result = await attachWordAddinResultForSource({
      workspaceDir,
      sourceAbs: "/tmp/整节.docx",
      outputPath: "/tmp/整节_01.docx",
      hunks: [sectionRewrite],
      summary: "整节重写",
    });
    expect(result.attached).toEqual([created.request.id]);
    const row = readWordAddinReview(workspaceDir, created.request.id);
    expect(row?.state).toBe("ready");
    expect(row?.hunks).toEqual([]);
    expect(row?.summary).toContain("无可就地落改锚点");
  });
});
