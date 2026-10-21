import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentTurn } from "../agent/types.js";
import {
  buildTurnReplayReportMarkdown,
  collectTurnReplayRows,
  deriveStopReason,
  discoverTurnWorkspaces,
  summarizeTurnReplay,
  turnReplayRow,
} from "./turn-loop-replay.js";

const tempDirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-replay-"));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
  return dir;
}

/** A run root that holds per-task workspaces but has no `sessions/` itself. */
function bareRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-replay-root-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function turn(overrides: Partial<AgentTurn> & { turnId: string }): AgentTurn {
  return {
    sessionId: "s1",
    instruction: "整理材料",
    messages: [],
    toolCallsExecuted: 0,
    status: "completed",
    startedAt: "2026-10-01T00:00:00.000Z",
    completedAt: "2026-10-01T00:00:10.000Z",
    ...overrides,
  };
}

describe("turn replay rows", () => {
  it("derives a stop reason for legacy rows that predate the field", () => {
    expect(deriveStopReason(turn({ turnId: "t", stopReason: "verify_cap" }))).toBe("verify_cap");
    expect(deriveStopReason(turn({ turnId: "t", status: "completed" }))).toBe("delivered");
    expect(deriveStopReason(turn({ turnId: "t", status: "error" }))).toBe("model_error");
    expect(deriveStopReason(turn({ turnId: "t", status: "error", error: "aborted_by_user" }))).toBe(
      "aborted",
    );
    expect(deriveStopReason(turn({ turnId: "t", status: "awaiting_approval" }))).toBe(
      "awaiting_approval",
    );
    expect(turnReplayRow(turn({ turnId: "t", status: "completed" })).stopReasonSource).toBe(
      "derived",
    );
    expect(turnReplayRow(turn({ turnId: "t", stopReason: "delivered" })).stopReasonSource).toBe(
      "recorded",
    );
  });

  it("falls back to assistant message count when roundCount is absent", () => {
    const row = turnReplayRow(
      turn({
        turnId: "t",
        messages: [
          { role: "assistant", content: "", timestamp: "t" },
          { role: "tool", content: "", timestamp: "t" },
          { role: "assistant", content: "", timestamp: "t" },
        ],
      }),
    );
    expect(row.rounds).toBe(2);
    expect(row.roundsSource).toBe("assistant_fallback");
    expect(row.durationMs).toBe(10_000);
  });

  it("reads every session file, filters by since, and keeps the last duplicate", () => {
    const dir = workspace();
    const file = path.join(dir, "sessions", "s1.turns.jsonl");
    fs.writeFileSync(
      file,
      [
        JSON.stringify(turn({ turnId: "a", stopReason: "delivered" })),
        JSON.stringify(
          turn({
            turnId: "b",
            stopReason: "tool_budget",
            toolCallsExecuted: 80,
            startedAt: "2026-10-02T00:00:00.000Z",
          }),
        ),
        JSON.stringify(turn({ turnId: "a", stopReason: "verify_cap" })),
        "not-json",
      ].join("\n"),
      "utf8",
    );

    const all = collectTurnReplayRows(dir);
    expect(all.map((row) => row.turnId)).toEqual(["a", "b"]);
    expect(all[0]?.stopReason).toBe("verify_cap");

    const recent = collectTurnReplayRows(dir, { since: "2026-10-02T00:00:00.000Z" });
    expect(recent.map((row) => row.turnId)).toEqual(["b"]);
  });
});

describe("turn replay summary", () => {
  it("reports completion rate, stop distribution, rounds, tools, and bounce convergence", () => {
    const rows = [
      turnReplayRow(
        turn({ turnId: "1", stopReason: "delivered", roundCount: 3, toolCallsExecuted: 5 }),
      ),
      turnReplayRow(
        turn({
          turnId: "2",
          stopReason: "delivered",
          roundCount: 4,
          toolCallsExecuted: 7,
          sameTurnVerify: {
            red: false,
            issues: [],
            bounceCount: 2,
            lastTool: "update_draft",
          },
        }),
      ),
      turnReplayRow(
        turn({
          turnId: "3",
          stopReason: "verify_cap",
          status: "completed",
          roundCount: 5,
          toolCallsExecuted: 9,
        }),
      ),
      turnReplayRow(
        turn({
          turnId: "4",
          stopReason: "tool_budget",
          roundCount: 6,
          toolCallsExecuted: 80,
        }),
      ),
    ];
    const summary = summarizeTurnReplay(rows);
    expect(summary.total).toBe(4);
    expect(summary.delivered).toBe(2);
    expect(summary.completionRate).toBe(0.5);
    expect(summary.cleanDelivered).toBe(2);
    expect(summary.cleanDeliveryRate).toBe(0.5);
    expect(summary.loopRows).toBe(4);
    expect(summary.loopCleanDeliveryRate).toBe(0.5);
    expect(summary.legacyRows).toBe(0);
    expect(summary.legacyRoundRows).toBe(0);
    expect(summary.completionRateRecorded).toBe(0.5);
    expect(summary.buckets).toMatchObject({ delivered: 2, needs_lawyer: 1, budget: 1 });
    expect(summary.stopReasons[0]).toEqual({ reason: "delivered", count: 2 });
    expect(summary.avgRounds).toBe(4.5);
    expect(summary.avgToolCalls).toBe(25.25);
    expect(summary.bounceTurns).toBe(1);
    expect(summary.bounceConvergenceRate).toBe(1);
    expect(summary.avgDurationMs).toBe(10_000);
  });

  it("is empty-safe and labels itself as real-turn data", () => {
    const summary = summarizeTurnReplay([]);
    expect(summary.total).toBe(0);
    expect(summary.completionRate).toBe(0);
    expect(summary.bounceConvergenceRate).toBe(0);
    const markdown = buildTurnReplayReportMarkdown(summary);
    expect(markdown).toContain("回合数：0");
    expect(markdown).toContain("真实回合");
  });

  it("flags legacy rows instead of pretending their stop causes are real", () => {
    const legacy = [
      turnReplayRow(turn({ turnId: "1", status: "completed" })),
      turnReplayRow(turn({ turnId: "2", status: "completed" })),
      turnReplayRow(turn({ turnId: "3", stopReason: "tool_budget", status: "completed" })),
    ];
    const summary = summarizeTurnReplay(legacy);
    expect(summary.legacyRows).toBe(2);
    expect(summary.recordedRows).toBe(1);
    // The one recorded row stopped on budget, so it is not a clean delivery;
    // legacy "completed" rows never count as clean.
    expect(summary.cleanDelivered).toBe(0);
    expect(summary.completionRateRecorded).toBe(0);
    const markdown = buildTurnReplayReportMarkdown(summary);
    expect(markdown).toContain("历史回合");
    expect(markdown).toContain("0/1");
    expect(markdown).toContain("不等于真实停因分布");
  });
});

describe("turn replay workspace discovery", () => {
  it("finds per-task benchmark workspaces under a run root", () => {
    const root = bareRoot();
    for (const task of ["case-10", "case-23", "consult-5"]) {
      fs.mkdirSync(path.join(root, task, "sessions"), { recursive: true });
      fs.writeFileSync(
        path.join(root, task, "sessions", "s.turns.jsonl"),
        `${JSON.stringify(turn({ turnId: task, sessionId: task, stopReason: "delivered" }))}\n`,
      );
    }
    const found = discoverTurnWorkspaces(root);
    expect(found.map((dir) => path.basename(dir))).toEqual(["case-10", "case-23", "consult-5"]);

    const rows = collectTurnReplayRows(found);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.sessionId))).toEqual(
      new Set(["case-10", "case-23", "consult-5"]),
    );
  });

  it("keeps nested per-task workspaces even when the root has its own sessions", () => {
    const root = workspace();
    for (const task of ["case-1", "case-2"]) {
      fs.mkdirSync(path.join(root, task, "sessions"), { recursive: true });
    }
    const found = discoverTurnWorkspaces(root);
    expect(found).toContain(root);
    expect(found.map((dir) => path.basename(dir))).toEqual(
      expect.arrayContaining(["case-1", "case-2"]),
    );
  });

  it("treats a date-only --since as local midnight", () => {
    const dir = bareRoot();
    const sessions = path.join(dir, "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    const localMidnight = new Date(2026, 9, 1, 0, 0, 0);
    fs.writeFileSync(
      path.join(sessions, "s.turns.jsonl"),
      [
        JSON.stringify(
          turn({
            turnId: "early",
            stopReason: "delivered",
            startedAt: new Date(2026, 9, 1, 0, 30).toISOString(),
          }),
        ),
        JSON.stringify(
          turn({
            turnId: "prev",
            stopReason: "delivered",
            startedAt: new Date(2026, 8, 30, 23, 30).toISOString(),
          }),
        ),
      ].join("\n"),
    );
    const rows = collectTurnReplayRows(dir, { since: localMidnight });
    expect(rows.map((row) => row.turnId)).toEqual(["early"]);
  });

  it("does not collapse identical session/turn ids from different workspaces", () => {
    // 评测跑通常给每个 per-task workspace 复用同一 sessionId；按
    // (sessionId, turnId) 去重会把 9 个 case 并成 1 行。
    const root = bareRoot();
    for (const task of ["case-1", "case-2"]) {
      const sessions = path.join(root, task, "sessions");
      fs.mkdirSync(sessions, { recursive: true });
      fs.writeFileSync(
        path.join(sessions, "s.turns.jsonl"),
        `${JSON.stringify(turn({ turnId: "t", sessionId: "s", stopReason: "delivered" }))}\n`,
      );
    }
    const rows = collectTurnReplayRows(discoverTurnWorkspaces(root));
    expect(rows).toHaveLength(2);
  });

  it("stops scanning at maxDirs so a stray root cannot walk the disk", () => {
    const root = bareRoot();
    for (let i = 0; i < 5; i += 1) {
      fs.mkdirSync(path.join(root, `case-${i}`, "sessions"), { recursive: true });
    }
    const all = discoverTurnWorkspaces(root, { maxDepth: 2 });
    expect(all).toHaveLength(5);
    expect(discoverTurnWorkspaces(root, { maxDepth: 2, maxDirs: 2 }).length).toBeLessThan(5);
  });

  it("does not descend past the depth cap", () => {
    const root = bareRoot();
    fs.mkdirSync(path.join(root, "a", "b", "c", "d", "sessions"), { recursive: true });
    expect(discoverTurnWorkspaces(root, { maxDepth: 2 })).toEqual([]);
    expect(discoverTurnWorkspaces(root, { maxDepth: 5 })).toHaveLength(1);
  });
});
