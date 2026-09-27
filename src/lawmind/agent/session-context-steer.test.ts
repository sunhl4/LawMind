import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyClaimedSteerToHistory,
  claimAndApplyPendingSteer,
  claimPendingSteer,
  formatSteerUserMessage,
  normalizeSteerNote,
  queuePendingSteer,
} from "./session-context-steer.js";
import type { AgentSession } from "./types.js";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-steer-"));
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

describe("session-context-steer", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("queues then claims notes from sidecar without touching session.json", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const sessionId = "s-steer-1";
    const queued = queuePendingSteer(ws, sessionId, "不要写结论，先对责任上限");
    expect(queued.pendingCount).toBe(1);
    expect(fs.existsSync(path.join(ws, "sessions", `${sessionId}.json`))).toBe(false);

    const claimed = claimPendingSteer(ws, sessionId);
    expect(claimed).toEqual(["不要写结论，先对责任上限"]);
    expect(claimPendingSteer(ws, sessionId)).toEqual([]);
  });

  it("keeps the last eight notes", () => {
    const ws = tmpWs();
    dirs.push(ws);
    let lastDropped = 0;
    for (let i = 0; i < 10; i += 1) {
      lastDropped = queuePendingSteer(ws, "s2", `指示 ${i}`).dropped;
    }
    expect(lastDropped).toBe(1);
    const claimed = claimPendingSteer(ws, "s2");
    expect(claimed).toHaveLength(8);
    expect(claimed[0]).toBe("指示 2");
    expect(claimed[7]).toBe("指示 9");
  });

  it("keeps line breaks and marks a cut-off note", () => {
    const kept = normalizeSteerNote("第3条改成限额\n不要动第8条");
    expect(kept.truncated).toBe(false);
    expect(kept.text).toBe("第3条改成限额\n不要动第8条");
    const long = normalizeSteerNote(`甲${"条".repeat(2_000)}`);
    expect(long.truncated).toBe(true);
    expect(long.text.endsWith("…（后文已截断）")).toBe(true);
    expect(long.text.length).toBeLessThanOrEqual(2_000);
  });

  it("redelivers a claimed note when history does not contain it yet", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const session = emptySession("s-crash");
    queuePendingSteer(ws, session.sessionId, "先改违约金");
    const first = claimAndApplyPendingSteer(session, ws);
    expect(first).toEqual(["先改违约金"]);
    const reloaded = emptySession(session.sessionId);
    const again = claimAndApplyPendingSteer(reloaded, ws);
    expect(again).toEqual(["先改违约金"]);
    expect(claimAndApplyPendingSteer(reloaded, ws)).toEqual([]);
  });

  it("appends a lawyer-facing user note for the next model round", () => {
    const session = emptySession("s3");
    expect(applyClaimedSteerToHistory(session, ["先改第 8 条"])).toBe(true);
    const last = session.conversationHistory[0];
    expect(last?.role).toBe("user");
    expect(last?.content).toContain("【律师中途指示】");
    expect(last?.content).toContain("先改第 8 条");
    expect(formatSteerUserMessage(["a", "b"])).toContain("1. a");
  });
});
