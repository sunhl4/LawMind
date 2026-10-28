import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatOpsDoctorSnapshot, gatherOpsDoctorSnapshot } from "./ops-doctor.js";

const quiet = {
  scannedSessions: 4,
  corruptSessionCount: 0,
  repairableDriftCount: 0,
  orphanMatterCount: 0,
  unsignedSkillCount: 0,
  indexReady: true,
  stale: false,
};

describe("formatOpsDoctorSnapshot", () => {
  it("prints quiet lines plus execution-surface inventory when nothing needs a human", () => {
    const snap = formatOpsDoctorSnapshot(quiet);
    expect(snap.projectionDrift).toBe(false);
    expect(snap.lines.slice(0, 3)).toEqual([
      "会话：最近 4 个会话的工具调用配对完好。",
      "投影：CASE.md 的结构化字段与 matter.json 一致。",
      "索引：就绪。",
    ]);
    expect(snap.lines.some((line) => line.startsWith("执行面：持久"))).toBe(true);
    expect(snap.lines.some((line) => line.startsWith("执行面：凭据"))).toBe(true);
  });

  it("does not treat a changed source file as a full rebuild", () => {
    const snap = formatOpsDoctorSnapshot({
      ...quiet,
      scannedSessions: 1,
      stale: true,
      staleReason: "sources_changed",
    });
    expect(snap.projectionDrift).toBe(false);
    expect(snap.lines[2]).toContain("不必整库重建");
  });

  it("flags field drift separately from an archive that has no matter.json", () => {
    const snap = formatOpsDoctorSnapshot({
      ...quiet,
      scannedSessions: 2,
      corruptSessionCount: 1,
      repairableDriftCount: 2,
      orphanMatterCount: 1,
      indexReady: false,
      stale: true,
      staleReason: "index_missing",
    });
    expect(snap.projectionDrift).toBe(true);
    expect(snap.lines[0]).toContain("--fix");
    expect(snap.lines[1]).toContain("matter-repair-projection");
    expect(snap.lines[1]).toContain("补上案件记录");
    expect(snap.lines[2]).toContain("检索一次就会建");
  });

  it("says when a custom skill is off because the signature failed", () => {
    const snap = formatOpsDoctorSnapshot({ ...quiet, unsignedSkillCount: 2 });
    expect(snap.projectionDrift).toBe(false);
    expect(snap.unsignedSkillCount).toBe(2);
    expect(
      snap.lines.some((line) => line.startsWith("技能：") && line.includes("不会在对话里报错")),
    ).toBe(true);
  });

  it("prints the prompt-budget health line before the execution-surface inventory (P1-b)", () => {
    const promptBudget = {
      turns: 3,
      degradedTurns: 0,
      droppedTurns: 0,
      droppedFragmentTotal: 0,
      droppedKindTurns: {},
      skillTruncatedTurns: 0,
      protocolTruncatedTurns: 0,
      peakFillRatio: 0.53,
      peakFillKeptTokens: 6_310,
      peakFillBudgetTokens: 12_000,
      averageFillRatio: 0.4,
      windowFrom: "2026-10-26T00:00:00.000Z",
      windowTo: "2026-10-26T01:00:00.000Z",
      truncatedWindow: false,
      status: "ok" as const,
      reasons: [],
    };
    const snap = formatOpsDoctorSnapshot({ ...quiet, promptBudget });
    const budgetIndex = snap.lines.findIndex((line) => line.startsWith("提示词预算："));
    const surfaceIndex = snap.lines.findIndex((line) => line.startsWith("执行面：持久"));
    expect(budgetIndex).toBe(3);
    expect(budgetIndex).toBeLessThan(surfaceIndex);
    expect(snap.lines[budgetIndex]).toContain("峰值 53%");
    expect(snap.promptBudget).toEqual(promptBudget);
  });

  it("omits the prompt-budget line when no scan was supplied", () => {
    const snap = formatOpsDoctorSnapshot(quiet);
    expect(snap.lines.some((line) => line.startsWith("提示词预算："))).toBe(false);
    expect(snap.promptBudget).toBeUndefined();
  });
});

describe("gatherOpsDoctorSnapshot storage quota", () => {
  it("reads storage.quotaGb from lawmind.policy.json and warns", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-doctor-quota-"));
    try {
      fs.mkdirSync(path.join(dir, "cases", "m1"), { recursive: true });
      fs.writeFileSync(path.join(dir, "cases", "m1", "matter.json"), "{}");
      fs.writeFileSync(
        path.join(dir, "lawmind.policy.json"),
        JSON.stringify({ schemaVersion: 1, storage: { quotaGb: 0.00000001 } }),
        "utf8",
      );
      const snapshot = await gatherOpsDoctorSnapshot(dir);
      expect(snapshot.storage?.quota?.limitBytes).toBe(10);
      expect(snapshot.storage?.quota?.exceeded).toBe(true);
      expect(snapshot.storage?.warnings.join("\n")).toContain("storage.quotaGb");
      expect(snapshot.lines.join("\n")).toContain("工作区合计");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
