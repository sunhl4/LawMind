import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMemoryAdoptionWrite } from "../memory/adoption-apply.js";
import { adoptMemorySuggestion, listMemorySuggestions } from "../memory/adoption-service.js";
import {
  appendLawyerProfileLearning,
  rotateLawyerProfileSectionEight,
  SECTION_EIGHT_MAX_BULLETS,
} from "../memory/lawyer-profile-learning.js";
import {
  captureDraftEditLearning,
  collectDraftEditDeltas,
  extractChangeSpan,
  formatEditLearningCandidates,
} from "./draft-edit-learning.js";

describe("draft-edit-learning", () => {
  let workspaceDir: string;
  let auditDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-edit-learn-"));
    auditDir = path.join(workspaceDir, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("extractChangeSpan isolates the changed middle", () => {
    expect(extractChangeSpan("违约金按日万分之五", "违约金按日万分之三")).toEqual({
      removed: "五",
      added: "三",
    });
    expect(extractChangeSpan("同一段文字", "同一段文字")).toBeUndefined();
    expect(extractChangeSpan("", "新增一句完整的话")).toEqual({
      removed: "",
      added: "新增一句完整的话",
    });
  });

  it("collectDraftEditDeltas keeps only sections the lawyer really changed", () => {
    const before = [
      { heading: "结论", body: "违约金偏高，建议下调。" },
      { heading: "风险", body: "存在履约风险。" },
    ];
    const after = [
      { heading: "结论", body: "违约金偏高，建议下调至日万分之三并设责任上限。" },
      { heading: "风险", body: "存在履约风险。" },
      { heading: "新增节", body: "本节由律师新增。" },
    ];
    const deltas = collectDraftEditDeltas(before, after);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.sectionHeading).toBe("结论");
    expect(deltas[0]?.added).toContain("责任上限");
  });

  it("ignores trivial edits below the minimum delta", () => {
    const deltas = collectDraftEditDeltas(
      [{ heading: "结论", body: "违约金按日万分之五计算。" }],
      [{ heading: "结论", body: "违约金按日万分之五计算，" }],
    );
    expect(deltas).toEqual([]);
  });

  it("formats candidates as what the lawyer changed, capped at three", () => {
    const deltas = [
      { sectionHeading: "A", removed: "旧表述", added: "新表述一" },
      { sectionHeading: "B", removed: "", added: "新增表述二" },
      { sectionHeading: "C", removed: "x", added: "新增表述三" },
      { sectionHeading: "D", removed: "y", added: "新增表述四" },
    ];
    const candidates = formatEditLearningCandidates(deltas);
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toBe("「A」：改前「旧表述」→ 改后「新表述一」");
    expect(candidates[1]).toBe("「B」：新增「新增表述二」");
  });

  it("capture creates pending suggestions only — LAWYER_PROFILE stays untouched", async () => {
    const created = await captureDraftEditLearning({
      workspaceDir,
      auditDir,
      taskId: "t-1",
      before: [{ heading: "结论", body: "责任条款约定以合同金额为限。" }],
      after: [{ heading: "结论", body: "责任条款约定以已付费用为限，不含间接损失。" }],
    });
    expect(created.length).toBeGreaterThan(0);
    const pending = await listMemorySuggestions(workspaceDir, { state: "pending" });
    expect(pending.some((r) => r.kind === "lawyer.profile_learning")).toBe(true);
    // 未确认前画像不存在。
    expect(fs.existsSync(path.join(workspaceDir, "LAWYER_PROFILE.md"))).toBe(false);
  });

  it("confirm writes LAWYER_PROFILE §八 via the adoption writer", async () => {
    await captureDraftEditLearning({
      workspaceDir,
      auditDir,
      taskId: "t-2",
      before: [{ heading: "结论", body: "责任条款约定以合同金额为限。" }],
      after: [{ heading: "结论", body: "责任条款约定以已付费用为限，不含间接损失。" }],
    });
    const pending = await listMemorySuggestions(workspaceDir, { state: "pending" });
    const target = pending.find((r) => r.kind === "lawyer.profile_learning");
    expect(target).toBeDefined();
    const result = await adoptMemorySuggestion(workspaceDir, auditDir, target!.id, (rec) =>
      applyMemoryAdoptionWrite(workspaceDir, rec, { auditDir }),
    );
    expect(result.ok).toBe(true);
    const profile = fs.readFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "utf8");
    expect(profile).toContain("## 八、个人积累");
    // 候选原样落盘：律师确认的是这条「改前/改后」记录，不是被系统重写过的总结。
    expect(profile).toContain("改前");
    expect(profile).toContain("已付费用为限");
  });

  it("rotates §八 overflow into the archive so the hot file stays bounded", async () => {
    for (let i = 0; i < 8; i += 1) {
      await appendLawyerProfileLearning(workspaceDir, `学习条目 ${i}`, "manual");
    }
    const rotated = await rotateLawyerProfileSectionEight(workspaceDir, { maxBullets: 5 });
    expect(rotated.rotated).toBe(3);
    expect(rotated.archivePath).toBeDefined();
    const profile = fs.readFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "utf8");
    const sectionEight = profile.slice(profile.indexOf("## 八、个人积累"));
    const bullets = sectionEight.split("\n").filter((l) => l.startsWith("- [")).length;
    expect(bullets).toBeLessThanOrEqual(5);
    // 归档保留被移出的内容，不丢。
    const archive = fs.readFileSync(rotated.archivePath!, "utf8");
    expect(archive).toContain("学习条目 0");
    expect(archive).toContain("学习条目 2");
    expect(SECTION_EIGHT_MAX_BULLETS).toBeGreaterThan(5);
  });
});
