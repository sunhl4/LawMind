import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../agent/types.js";
import {
  claimAndApplyWorkGoal,
  ensureLawyerWorkForTurn,
  formatWorkGoalUserMessage,
  goalFromInstruction,
  setLawyerWorkGoal,
} from "./goal.js";
import { findLawyerWork } from "./store.js";

const dirs: string[] = [];

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-work-goal-"));
  dirs.push(dir);
  return dir;
}

function emptySession(sessionId: string): AgentSession {
  return {
    sessionId,
    actorId: "lawyer",
    turns: [],
    conversationHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("LawyerWork goal", () => {
  it("skips file-context prefixes when deriving a goal", () => {
    expect(goalFromInstruction("【LawMind 文件页】\n- [工作区] a.docx\n请审查违约责任")).toBe(
      "请审查违约责任",
    );
  });

  it("opens a work for the turn and claims the goal as a user note", () => {
    const ws = tmpWs();
    ensureLawyerWorkForTurn({
      workspaceDir: ws,
      sessionId: "sess-goal",
      instruction: "请按买方立场审查付款条款",
    });
    const work = findLawyerWork(ws, { sessionId: "sess-goal" });
    expect(work?.goal).toBe("请按买方立场审查付款条款");

    const session = emptySession("sess-goal");
    const claimed = claimAndApplyWorkGoal(session, ws);
    expect(claimed).toBe("请按买方立场审查付款条款");
    expect(session.conversationHistory[0]?.content).toBe(
      formatWorkGoalUserMessage("请按买方立场审查付款条款"),
    );
    expect(claimAndApplyWorkGoal(session, ws)).toBeNull();
  });

  it("queues a goal change without auto-running a turn", () => {
    const ws = tmpWs();
    ensureLawyerWorkForTurn({
      workspaceDir: ws,
      sessionId: "sess-2",
      instruction: "旧目标",
    });
    const work = findLawyerWork(ws, { sessionId: "sess-2" })!;
    setLawyerWorkGoal(ws, work.workId, "先对管辖条款");
    const session = emptySession("sess-2");
    expect(claimAndApplyWorkGoal(session, ws)).toBe("先对管辖条款");
    expect(session.conversationHistory[0]?.content).toContain("先对管辖条款");
  });
});
