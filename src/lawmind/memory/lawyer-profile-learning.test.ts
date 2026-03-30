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
    await appendLawyerProfileLearning(ws, "prefer IRAC", "manual");
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
});
