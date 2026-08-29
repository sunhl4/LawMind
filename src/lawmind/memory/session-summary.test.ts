import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentSession } from "../agent/types.js";
import {
  appendSessionSummary,
  buildSessionSummaryChunkFromTurn,
  maybeAutoAppendSessionSummary,
  shouldExtractSessionSummary,
} from "./session-summary.js";

function mkSession(overrides: Partial<AgentSession> = {}): AgentSession {
  const now = new Date().toISOString();
  return {
    sessionId: "s1",
    actorId: "lawyer",
    matterId: "m1",
    turns: [],
    conversationHistory: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("shouldExtractSessionSummary", () => {
  it("returns false without matterId", () => {
    const s = mkSession({ matterId: undefined });
    expect(shouldExtractSessionSummary(s)).toBe(false);
  });

  it("returns true when enough user/assistant content", () => {
    const s = mkSession({
      conversationHistory: [
        { role: "user", content: "请审查合同".repeat(500), timestamp: now() },
        { role: "assistant", content: "好的，开始审查。".repeat(500), timestamp: now() },
        { role: "user", content: "补充违约责任条款。", timestamp: now() },
        { role: "assistant", content: "已记录。", timestamp: now() },
      ],
      turns: [{ turnId: "t1" } as AgentSession["turns"][0]],
    });
    expect(shouldExtractSessionSummary(s)).toBe(true);
  });

  it("skips when last summary turn is recent", () => {
    const s = mkSession({
      conversationHistory: [{ role: "user", content: "x".repeat(5000), timestamp: now() }],
      turns: [
        { turnId: "t1" } as AgentSession["turns"][0],
        { turnId: "t2" } as AgentSession["turns"][0],
      ],
      lastSessionSummaryTurnCount: 2,
    });
    expect(shouldExtractSessionSummary(s)).toBe(false);
  });
});

describe("maybeAutoAppendSessionSummary", () => {
  it("writes session-summary.md under case", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sm-"));
    const session = mkSession({
      conversationHistory: [
        { role: "user", content: "用户问题：违约责任如何主张？".repeat(400), timestamp: now() },
        {
          role: "assistant",
          content: "需先固定违约事实与通知送达。".repeat(400),
          timestamp: now(),
        },
        { role: "user", content: "请写入 session 摘要。", timestamp: now() },
        { role: "assistant", content: "好的。", timestamp: now() },
      ],
      turns: [
        {
          turnId: "turn-1",
          sessionId: "s1",
          instruction: "违约责任",
          messages: [],
          toolCallsExecuted: 0,
          status: "completed",
          result: "需先固定违约事实。",
          startedAt: now(),
          completedAt: now(),
        },
      ],
    });
    maybeAutoAppendSessionSummary(ws, session, session.turns[0]);
    const fp = path.join(ws, "cases", "m1", "session-summary.md");
    expect(fs.existsSync(fp)).toBe(true);
    const raw = fs.readFileSync(fp, "utf8");
    expect(raw).toContain("违约责任");
  });
});

function now(): string {
  return new Date().toISOString();
}

describe("buildSessionSummaryChunkFromTurn", () => {
  it("includes instruction and reply excerpt", () => {
    const session = mkSession();
    const chunk = buildSessionSummaryChunkFromTurn(
      {
        turnId: "t1",
        sessionId: "s1",
        instruction: "检索公司法",
        messages: [],
        toolCallsExecuted: 1,
        status: "completed",
        result: "找到三条相关条文。",
        startedAt: now(),
        completedAt: now(),
      },
      session,
    );
    expect(chunk).toContain("检索公司法");
    expect(chunk).toContain("三条相关条文");
  });
});

describe("appendSessionSummary", () => {
  it("rejects empty matter", () => {
    expect(appendSessionSummary("/tmp", "", "x").ok).toBe(false);
  });
});
