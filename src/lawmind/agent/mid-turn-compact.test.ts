import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compactDigestPath } from "./compact.js";
import {
  applyMidTurnCompact,
  MID_TURN_COMPACT_MAX,
  midTurnBudgetOverTrigger,
  shouldCompactMidTurn,
} from "./mid-turn-compact.js";
import type { AgentMessage, AgentSession } from "./types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function makeWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-midturn-"));
  tempDirs.push(dir);
  return dir;
}

function sessionWith(messages: AgentMessage[], matterId?: string): AgentSession {
  return {
    sessionId: "s-midturn",
    actorId: "lawyer",
    turns: [],
    matterId,
    conversationHistory: messages,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function longHistory(pairs: number): AgentMessage[] {
  const out: AgentMessage[] = [{ role: "system", content: "sys", timestamp: "t" }];
  for (let i = 0; i < pairs; i += 1) {
    out.push(
      { role: "user", content: `历史轮 ${i}：继续讨论付款节奏`, timestamp: "t" },
      { role: "assistant", content: `历史答 ${i}：可分期。`, timestamp: "t" },
    );
  }
  return out;
}

describe("shouldCompactMidTurn", () => {
  it("第一次采样前不整理（回合开始那次已经跑过）", () => {
    expect(
      shouldCompactMidTurn({
        roundIndex: 1,
        used: 95_000,
        effectiveLimit: 95_000,
        level: "compact",
        compactionsDone: 0,
      }),
    ).toBe(false);
    // 模型一上来就退让也一样：第 1 轮不重写历史，交给反弹处理。
    expect(
      shouldCompactMidTurn({
        roundIndex: 1,
        used: 95_000,
        effectiveLimit: 95_000,
        level: "compact",
        compactionsDone: 0,
        force: true,
      }),
    ).toBe(false);
  });

  it("越线（或达到触发比例）才整理，且受每回合上限约束", () => {
    const base = { roundIndex: 2, used: 80_000, effectiveLimit: 95_000 };
    expect(shouldCompactMidTurn({ ...base, level: "warn", compactionsDone: 0 })).toBe(false);
    expect(shouldCompactMidTurn({ ...base, level: "compact", compactionsDone: 0 })).toBe(true);
    expect(
      shouldCompactMidTurn({
        ...base,
        used: 86_000,
        level: "warn",
        compactionsDone: 0,
      }),
    ).toBe(true);
    expect(
      shouldCompactMidTurn({
        ...base,
        level: "compact",
        compactionsDone: MID_TURN_COMPACT_MAX,
      }),
    ).toBe(false);
    // 模型已证明没空间：跳过比例检查，但要服从上限。
    expect(
      shouldCompactMidTurn({ ...base, used: 1, level: "ok", compactionsDone: 0, force: true }),
    ).toBe(true);
    expect(
      shouldCompactMidTurn({
        ...base,
        used: 1,
        level: "ok",
        compactionsDone: MID_TURN_COMPACT_MAX,
        force: true,
      }),
    ).toBe(false);
  });

  it("midTurnBudgetOverTrigger：compact 级一律越线，其余按比例", () => {
    expect(midTurnBudgetOverTrigger({ used: 0, effectiveLimit: 95_000, level: "compact" })).toBe(
      true,
    );
    expect(midTurnBudgetOverTrigger({ used: 85_500, effectiveLimit: 95_000, level: "warn" })).toBe(
      true,
    );
    expect(midTurnBudgetOverTrigger({ used: 80_000, effectiveLimit: 95_000, level: "warn" })).toBe(
      false,
    );
    expect(
      midTurnBudgetOverTrigger({
        used: 40_000,
        effectiveLimit: 95_000,
        level: "ok",
        triggerRatio: 0.4,
      }),
    ).toBe(true);
  });

  it("provider 回报的真实占用高于估算时用它触发（估算偏小不再拖到满窗）", () => {
    const base = {
      roundIndex: 2,
      effectiveLimit: 95_000,
      level: "warn" as const,
      compactionsDone: 0,
    };
    expect(shouldCompactMidTurn({ ...base, used: 50_000 })).toBe(false);
    // 估算 50k，但 provider 说上一轮就已占 90k → 必须现在整理。
    expect(shouldCompactMidTurn({ ...base, used: 50_000, measuredUsed: 90_000 })).toBe(true);
    // 真实占用更小时不放宽：估算偏大也该整理（保守方向）。
    expect(shouldCompactMidTurn({ ...base, used: 90_000, measuredUsed: 10_000 })).toBe(true);
  });
});

describe("applyMidTurnCompact", () => {
  it("越线时在工具轮边界压缩，保留尾部、写 digest、置重注与审计位", () => {
    const workspaceDir = makeWorkspace();
    const session = sessionWith(longHistory(40), "m-midturn");
    const before = session.conversationHistory.length;

    const outcome = applyMidTurnCompact(session, workspaceDir, {
      maxHistoryMessages: 6,
      roundIndex: 2,
      compactionsDone: 0,
      contextTokens: 16_000,
      triggerRatio: 0.05,
    });

    expect(outcome.applied).toBe(true);
    if (!outcome.applied) {
      return;
    }
    expect(outcome.droppedMessageCount).toBeGreaterThan(0);
    expect(session.conversationHistory.length).toBeLessThan(before);
    expect(session.lastCompactBoundary?.midTurn).toBe(true);
    expect(session.lastCompactBoundary?.roundIndex).toBe(2);
    // 红线重注已注入 → 标记被消费（下一轮采样仍看得到约束）。
    expect(session.needsCompactReinjection).toBe(false);
    expect(
      session.conversationHistory.some((m) => (m.content ?? "").includes("压缩后红线重注")),
    ).toBe(true);
    expect(fs.existsSync(compactDigestPath(workspaceDir, "m-midturn"))).toBe(true);
  });

  it("未越线时不动历史", () => {
    const workspaceDir = makeWorkspace();
    const session = sessionWith(longHistory(2), "m-ok");
    const before = session.conversationHistory.map((m) => m.content);

    const outcome = applyMidTurnCompact(session, workspaceDir, {
      maxHistoryMessages: 100,
      roundIndex: 2,
      compactionsDone: 0,
      contextTokens: 128_000,
    });

    expect(outcome).toEqual({ applied: false, reason: "below_trigger" });
    expect(session.conversationHistory.map((m) => m.content)).toEqual(before);
  });

  it("尾巴自身已超窗口（压了不减）时不动历史，也不把摘要堆进去", () => {
    const workspaceDir = makeWorkspace();
    const session = sessionWith(longHistory(1), "m-thin");
    const before = session.conversationHistory.length;

    // force：跳过比例检查直接尝试腾空间，命中的是「压了也不减」这条兜底。
    const outcome = applyMidTurnCompact(session, workspaceDir, {
      maxHistoryMessages: 100,
      roundIndex: 3,
      compactionsDone: 0,
      contextTokens: 16_000,
      force: true,
    });

    expect(outcome).toEqual({ applied: false, reason: "no_reduction" });
    expect(session.conversationHistory.length).toBe(before);
    expect(session.needsCompactReinjection).toBeUndefined();
  });
});
