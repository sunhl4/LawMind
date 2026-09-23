import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { automationsDir } from "./automation-paths.js";
import {
  AUTOMATION_RUN_RETENTION,
  assessAutomationPromotion,
  appendAutomationRun,
  automationRunFileName,
  automationRunsDir,
  deleteAutomationRunHistory,
  listAutomationRuns,
  pruneAutomationRuns,
  summarizeAutomationRuns,
  type AutomationRunRecord,
} from "./automation-run-history.js";
import { deleteAutomation } from "./lawyer-automations.js";

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auto-runs-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  dirs.length = 0;
});

let seq = 0;
function run(over: Partial<AutomationRunRecord> = {}): AutomationRunRecord {
  seq += 1;
  const n = String(seq).padStart(4, "0");
  return {
    runId: `r-${n}`,
    automationId: "a1",
    trigger: "schedule",
    status: "ok",
    startedAt: `2026-09-21T0${(seq % 9) + 1}:00:00.000Z`,
    finishedAt: `2026-09-21T0${(seq % 9) + 1}:00:05.000Z`,
    ...over,
  };
}

describe("automation run history storage", () => {
  it("lives under the automation directory, not beside it", () => {
    const ws = tmpWs();
    expect(automationRunsDir(ws, "a1")).toBe(path.join(automationsDir(ws), "a1", "runs"));
  });

  it("refuses an id that would escape the workspace", () => {
    const ws = tmpWs();
    expect(() => automationRunsDir(ws, "../../etc")).toThrow(/unsafe_automation_id/);
    expect(() => automationRunsDir(ws, "a/../b")).toThrow(/unsafe_automation_id/);
    expect(() => automationRunsDir(ws, "")).toThrow(/unsafe_automation_id/);
  });

  it("returns an empty history for an automation that never ran", () => {
    expect(listAutomationRuns(tmpWs(), "a1")).toEqual([]);
  });

  it("round-trips a record and reads newest first", () => {
    const ws = tmpWs();
    appendAutomationRun(ws, run({ startedAt: "2026-09-21T01:00:00.000Z", runId: "old" }));
    appendAutomationRun(ws, run({ startedAt: "2026-09-21T03:00:00.000Z", runId: "new" }));
    const runs = listAutomationRuns(ws, "a1");
    expect(runs.map((r) => r.runId)).toEqual(["new", "old"]);
  });

  it("keeps runs of different automations apart", () => {
    const ws = tmpWs();
    appendAutomationRun(ws, run({ automationId: "a1", runId: "x1" }));
    appendAutomationRun(ws, run({ automationId: "a2", runId: "x2" }));
    expect(listAutomationRuns(ws, "a1").map((r) => r.runId)).toEqual(["x1"]);
    expect(listAutomationRuns(ws, "a2").map((r) => r.runId)).toEqual(["x2"]);
  });

  it("honours the limit", () => {
    const ws = tmpWs();
    for (let i = 0; i < 5; i += 1) {
      appendAutomationRun(ws, run({ startedAt: `2026-09-21T0${i}:00:00.000Z`, runId: `r${i}` }));
    }
    expect(listAutomationRuns(ws, "a1", 2).map((r) => r.runId)).toEqual(["r4", "r3"]);
    expect(listAutomationRuns(ws, "a1", 0)).toEqual([]);
  });

  it("prunes to the retention cap so a long-lived routine cannot fill the disk", () => {
    const ws = tmpWs();
    for (let i = 0; i < AUTOMATION_RUN_RETENTION + 7; i += 1) {
      const hh = String(i).padStart(2, "0");
      appendAutomationRun(ws, run({ startedAt: `2026-09-21T${hh}:00:00.000Z`, runId: `r${i}` }));
    }
    const runs = listAutomationRuns(ws, "a1", 100);
    expect(runs).toHaveLength(AUTOMATION_RUN_RETENTION);
    expect(runs[0]?.runId).toBe(`r${AUTOMATION_RUN_RETENTION + 6}`);
  });

  it("honours an explicit keep value on append", () => {
    const ws = tmpWs();
    for (let i = 0; i < 5; i += 1) {
      appendAutomationRun(ws, run({ startedAt: `2026-09-21T0${i}:00:00.000Z` }), { keep: 2 });
    }
    expect(listAutomationRuns(ws, "a1", 100)).toHaveLength(2);
  });

  it("reports how many records it pruned", () => {
    const ws = tmpWs();
    for (let i = 0; i < 5; i += 1) {
      appendAutomationRun(ws, run({ startedAt: `2026-09-21T0${i}:00:00.000Z` }), { keep: 99 });
    }
    expect(pruneAutomationRuns(ws, "a1", 2)).toBe(3);
    expect(pruneAutomationRuns(ws, "a1", 2)).toBe(0);
    expect(pruneAutomationRuns(ws, "never-ran", 2)).toBe(0);
  });

  it("still reads the healthy records when one file is corrupt", () => {
    const ws = tmpWs();
    appendAutomationRun(ws, run({ startedAt: "2026-09-21T01:00:00.000Z", runId: "good-1" }));
    appendAutomationRun(ws, run({ startedAt: "2026-09-21T02:00:00.000Z", runId: "good-2" }));
    fs.writeFileSync(
      path.join(automationRunsDir(ws, "a1"), "2026-09-21T03-00-00-000Z__bad.json"),
      "{oops",
      "utf8",
    );
    expect(listAutomationRuns(ws, "a1", 10).map((r) => r.runId)).toEqual(["good-2", "good-1"]);
  });

  it("names files so lexical order is chronological order", () => {
    const a = automationRunFileName({ startedAt: "2026-09-21T01:00:00.000Z", runId: "a" });
    const b = automationRunFileName({ startedAt: "2026-09-21T02:00:00.000Z", runId: "b" });
    expect([b, a].toSorted()).toEqual([a, b]);
    // Windows 不允许文件名带冒号；换成 `-` 后仍保持字典序。
    expect(a).not.toContain(":");
  });

  it("deletes the whole history for one automation", () => {
    const ws = tmpWs();
    appendAutomationRun(ws, run());
    deleteAutomationRunHistory(ws, "a1");
    expect(listAutomationRuns(ws, "a1")).toEqual([]);
  });

  it("never throws when the run directory cannot be written", () => {
    const ws = tmpWs();
    // 把 runs 目录做成文件，写入必然失败——运行历史不能因此打挂一次真办件。
    fs.mkdirSync(automationRunsDir(ws, "a1"), { recursive: true });
    fs.rmSync(automationRunsDir(ws, "a1"), { recursive: true, force: true });
    fs.writeFileSync(automationRunsDir(ws, "a1"), "not a dir", "utf8");
    expect(() => appendAutomationRun(ws, run())).not.toThrow();
  });
});

describe("summarizeAutomationRuns", () => {
  it("counts each outcome and surfaces the newest timestamps", () => {
    const stats = summarizeAutomationRuns([
      run({
        status: "failed",
        errorCode: "mail_unconfigured",
        finishedAt: "2026-09-21T09:00:00.000Z",
      }),
      run({ status: "ok", finishedAt: "2026-09-21T08:00:00.000Z" }),
      run({
        status: "skipped",
        missingData: ["邮箱未配置"],
        finishedAt: "2026-09-21T07:00:00.000Z",
      }),
      run({ status: "blocked", finishedAt: "2026-09-21T06:00:00.000Z" }),
    ]);
    expect(stats.total).toBe(4);
    expect(stats.okCount).toBe(1);
    expect(stats.failedCount).toBe(1);
    expect(stats.skippedCount).toBe(1);
    expect(stats.blockedCount).toBe(1);
    expect(stats.missingDataCount).toBe(1);
    expect(stats.lastRunAt).toBe("2026-09-21T09:00:00.000Z");
    expect(stats.lastOkAt).toBe("2026-09-21T08:00:00.000Z");
    expect(stats.lastErrorCode).toBe("mail_unconfigured");
  });

  it("summarizes an empty history without inventing values", () => {
    const stats = summarizeAutomationRuns([]);
    expect(stats.total).toBe(0);
    expect(stats.lastRunAt).toBeUndefined();
    expect(stats.lastErrorCode).toBeUndefined();
  });
});

describe("assessAutomationPromotion", () => {
  it("refuses to promote before there is evidence", () => {
    const verdict = assessAutomationPromotion([run({ status: "ok" })]);
    expect(verdict.ready).toBe(false);
    expect(verdict.message).toContain("还需要再成功跑");
  });

  it("states the basis so a windowed verdict is never mistaken for full coverage", () => {
    // 对齐试点协议的样本纪律：只给「最近 3 次」而不交代总条数，会让
    // 「20 次里最后 3 次干净」与「总共只有 3 次」看起来一样。
    const many = [
      run({ status: "ok" }),
      run({ status: "ok" }),
      run({ status: "ok" }),
      run({ status: "failed" }),
      run({ status: "failed" }),
      run({ status: "failed" }),
      run({ status: "failed" }),
    ];
    const verdict = assessAutomationPromotion(many);
    expect(verdict.ready).toBe(true);
    expect(verdict.basis).toEqual({ usedRuns: 3, totalRuns: 7 });
    expect(verdict.message).toContain("依据最近 3 次");
    expect(verdict.message).toContain("共 7 次记录");
  });

  it("keeps 'not enough evidence' and 'something is wrong' as different sentences", () => {
    // 协议明确要求区分：前者是「没证据」，后者是「有证据的问题」。
    const insufficient = assessAutomationPromotion([run({ status: "ok" })]);
    const wrong = assessAutomationPromotion([
      run({ status: "failed" }),
      run({ status: "ok" }),
      run({ status: "ok" }),
    ]);
    expect(insufficient.message).toContain("才有依据");
    expect(wrong.message).toContain("失败");
    expect(wrong.message).not.toContain("才有依据");
  });

  it("reports the basis when refusing too", () => {
    const verdict = assessAutomationPromotion([run({ status: "failed" })]);
    expect(verdict.basis).toEqual({ usedRuns: 1, totalRuns: 1 });
    expect(verdict.message).toContain("共 1 次记录");
  });

  it("promotes after three clean runs", () => {
    const verdict = assessAutomationPromotion([
      run({ status: "ok" }),
      run({ status: "ok" }),
      run({ status: "ok" }),
    ]);
    expect(verdict.ready).toBe(true);
  });

  it("refuses when the recent runs include a failure", () => {
    const verdict = assessAutomationPromotion([
      run({ status: "ok" }),
      run({ status: "failed" }),
      run({ status: "ok" }),
    ]);
    expect(verdict.ready).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("失败");
  });

  it("refuses when the recent runs keep hitting missing data", () => {
    const verdict = assessAutomationPromotion([
      run({ status: "ok", missingData: ["邮箱未配置"] }),
      run({ status: "ok" }),
      run({ status: "ok" }),
    ]);
    expect(verdict.ready).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("资料缺失");
  });

  it("looks only at the most recent runs, not the whole history", () => {
    const verdict = assessAutomationPromotion([
      run({ status: "ok" }),
      run({ status: "ok" }),
      run({ status: "ok" }),
      run({ status: "failed" }),
      run({ status: "failed" }),
    ]);
    expect(verdict.ready).toBe(true);
  });
});

describe("deleteAutomation cleans run history", () => {
  it("removes the history directory so no orphan runs are left behind", () => {
    const ws = tmpWs();
    fs.mkdirSync(automationsDir(ws), { recursive: true });
    fs.writeFileSync(
      path.join(automationsDir(ws), "a-clean.json"),
      JSON.stringify({
        id: "a-clean",
        title: "t",
        enabled: true,
        presetId: "custom",
        matterId: "m1",
        schedule: { kind: "daily", hour: 9, minute: 0 },
        nextRunAt: "2026-09-22T01:00:00.000Z",
        allowSendEmailAfterApproval: false,
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      }),
      "utf8",
    );
    appendAutomationRun(ws, run({ automationId: "a-clean" }));

    expect(deleteAutomation(ws, "a-clean")).toBe(true);
    expect(fs.existsSync(automationRunsDir(ws, "a-clean"))).toBe(false);
  });
});
