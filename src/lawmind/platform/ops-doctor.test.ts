import { describe, expect, it } from "vitest";
import { formatOpsDoctorSnapshot } from "./ops-doctor.js";

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
  it("prints three quiet lines when nothing needs a human", () => {
    const snap = formatOpsDoctorSnapshot(quiet);
    expect(snap.projectionDrift).toBe(false);
    expect(snap.lines).toEqual([
      "会话：最近 4 个会话的工具调用配对完好。",
      "投影：CASE.md 的结构化字段与 matter.json 一致。",
      "索引：就绪。",
    ]);
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
});
