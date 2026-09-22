/**
 * 中断轮次（Codex 对齐）：应用退出/被杀留下「占位仍 running、无活回合」的轮次。
 * 这里只测纯判定与派生卡片——读路径不允许改写磁盘。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeTurnGateLeaseForTest } from "./session-turn-gate.js";
import {
  INTERRUPTED_ACTION_PREFIX,
  INTERRUPTED_TURN_GRACE_MS,
  applyDerivedInterruptedAction,
  buildInterruptedTurnAction,
  isInterruptedTurnAction,
  isInterruptedTurnView,
  isSessionTurnLive,
  lastInterruptedTurnView,
  resolveInterruptedActionForResume,
} from "./turn-interrupt.js";
import type { AgentSession, AgentTurn } from "./types.js";

const dirs: string[] = [];

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-turn-interrupt-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: "t-1",
    sessionId: "s-1",
    instruction: "按批注改这份合同",
    messages: [],
    toolCallsExecuted: 9,
    status: "running",
    startedAt: new Date(Date.now() - INTERRUPTED_TURN_GRACE_MS * 3).toISOString(),
    ...overrides,
  };
}

function session(turns: AgentTurn[]): AgentSession {
  return {
    sessionId: "s-1",
    actorId: "lawyer",
    matterId: "m-1",
    turns,
    conversationHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("turn interrupt (Codex-style)", () => {
  it("只在「仍 running + 过了宽限期」时判为中断", () => {
    expect(isInterruptedTurnView(turn())).toBe(true);
    expect(isInterruptedTurnView(turn({ status: "completed" }))).toBe(false);
    expect(isInterruptedTurnView(turn({ status: "paused" }))).toBe(false);
    // 刚起步的回合不算中断（避免与在跑回合抢判定）
    expect(isInterruptedTurnView(turn({ startedAt: new Date().toISOString() }))).toBe(false);
  });

  it("活回合租约存在时本会话视为在跑（不被误判中断）", () => {
    const ws = tmpWs();
    expect(isSessionTurnLive(ws, "s-1")).toBe(false);
    // 别的进程持有的租约 = 活（跨进程真相源）
    writeTurnGateLeaseForTest(ws, "s-1", {
      pid: process.ppid > 0 ? process.ppid : process.pid,
      startedAt: new Date().toISOString(),
      hostname: os.hostname(),
    });
    expect(isSessionTurnLive(ws, "s-1")).toBe(process.ppid > 0 && process.ppid !== process.pid);
    // 本进程持有的租约**不算**活：恢复入口自己会先拿租约，实时在跑由 live progress 判定。
    writeTurnGateLeaseForTest(ws, "s-1", {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      hostname: os.hostname(),
    });
    expect(isSessionTurnLive(ws, "s-1")).toBe(false);
    // 死进程的租约不算活
    writeTurnGateLeaseForTest(ws, "s-1", {
      pid: 999_999_999,
      startedAt: new Date().toISOString(),
      hostname: os.hostname(),
    });
    expect(isSessionTurnLive(ws, "s-1")).toBe(false);
  });

  it("派生卡片 id 稳定，且能被恢复入口按 id 找回", () => {
    const action = buildInterruptedTurnAction({
      sessionId: "s-1",
      turnId: "t-1",
      instruction: "按批注改这份合同",
      used: 9,
    });
    expect(action.id).toBe(`${INTERRUPTED_ACTION_PREFIX}t-1`);
    expect(action.kind).toBe("continue_tools");
    expect(action.trigger).toBe("interrupted");
    expect(isInterruptedTurnAction(action)).toBe(true);

    const s = session([turn()]);
    expect(resolveInterruptedActionForResume(s, false, action.id)?.id).toBe(action.id);
    // 会话在跑 / 轮次已收口 / 不认识的 id：都不派生
    expect(resolveInterruptedActionForResume(s, true, action.id)).toBeUndefined();
    expect(
      resolveInterruptedActionForResume(session([turn({ status: "completed" })]), false, action.id),
    ).toBeUndefined();
    expect(resolveInterruptedActionForResume(s, false, "other-action")).toBeUndefined();
  });

  it("读时视图不改磁盘，只把卡片挂到 pendingRequiresAction", () => {
    const s = session([turn()]);
    const view = applyDerivedInterruptedAction(s, false);
    expect(view?.status).toBe("interrupted");
    expect(s.pendingRequiresAction?.some(isInterruptedTurnAction)).toBe(true);
    // 不重复叠加
    applyDerivedInterruptedAction(s, false);
    expect(s.pendingRequiresAction?.filter(isInterruptedTurnAction)).toHaveLength(1);

    // 在跑的会话：不派生
    const live = session([turn()]);
    expect(lastInterruptedTurnView(live, true)).toBeUndefined();
  });
});
