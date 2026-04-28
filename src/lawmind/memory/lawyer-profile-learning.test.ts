import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendLawyerProfileLearning,
  buildLawyerProfileReviewLearningLine,
  ensureLawyerProfileSkeleton,
} from "./lawyer-profile-learning.js";

describe("lawyer-profile-learning", () => {
  let ws: string;

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("ensureLawyerProfileSkeleton creates file with section eight", async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-lp-"));
    await ensureLawyerProfileSkeleton(ws);
    const text = await fs.readFile(path.join(ws, "LAWYER_PROFILE.md"), "utf8");
    expect(text).toContain("## 八、个人积累");
    expect(text).toContain("_最后更新");
  });

  it("appendLawyerProfileLearning inserts before footer marker", async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-lp-"));
    await ensureLawyerProfileSkeleton(ws);
    const r = await appendLawyerProfileLearning(ws, "prefer IRAC", "manual");
    expect(r.skipped).toBe(false);
    const text = await fs.readFile(path.join(ws, "LAWYER_PROFILE.md"), "utf8");
    expect(text).toContain("[source:manual]");
    expect(text).toContain("prefer IRAC");
    const lastIdx = text.lastIndexOf("_最后更新");
    const prefIdx = text.indexOf("prefer IRAC");
    expect(prefIdx).toBeGreaterThan(-1);
    expect(prefIdx).toBeLessThan(lastIdx);
  });

  it("buildLawyerProfileReviewLearningLine", () => {
    expect(buildLawyerProfileReviewLearningLine("t1", "approved")).toContain("t1");
    expect(buildLawyerProfileReviewLearningLine("t1", "rejected", "bad")).toContain("bad");
  });

  it("skips duplicate review learning for the same taskId", async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-lp-dedupe-"));
    await ensureLawyerProfileSkeleton(ws);
    const line = buildLawyerProfileReviewLearningLine("tid-dedupe-1", "approved", "once");
    expect((await appendLawyerProfileLearning(ws, line, "review")).skipped).toBe(false);
    expect((await appendLawyerProfileLearning(ws, line, "review")).skipped).toBe(true);
    const text = await fs.readFile(path.join(ws, "LAWYER_PROFILE.md"), "utf8");
    expect(text.match(/tid-dedupe-1/g)?.length).toBe(1);
  });
});
