import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteSessionMessagePairAtUiIndex,
  listUiHistoryMap,
  truncateSessionFromUiIndex,
} from "./session-message-mutate.js";
import { createSession } from "./session.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-msg-mutate-"));
}

describe("session-message-mutate", () => {
  it("listUiHistoryMap skips system and empty assistant without trace", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    s.conversationHistory.push(
      { role: "system", content: "sys", timestamp: new Date().toISOString() },
      { role: "user", content: "q1", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a1", timestamp: new Date().toISOString() },
      { role: "user", content: "q2", timestamp: new Date().toISOString() },
      { role: "assistant", content: "", timestamp: new Date().toISOString() },
    );
    const map = listUiHistoryMap(s);
    expect(map.map((e) => e.role)).toEqual(["user", "assistant", "user"]);
    expect(map[0]?.historyIndex).toBe(1);
  });

  it("truncateSessionFromUiIndex removes from bubble onward", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    s.conversationHistory.push(
      { role: "system", content: "sys", timestamp: new Date().toISOString() },
      { role: "user", content: "q1", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a1", timestamp: new Date().toISOString() },
      { role: "user", content: "q2", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a2", timestamp: new Date().toISOString() },
    );
    const r = truncateSessionFromUiIndex(s, 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.removedCount).toBe(2);
    }
    expect(s.conversationHistory.map((m) => m.content)).toEqual(["sys", "q1", "a1"]);
  });

  it("deleteSessionMessagePairAtUiIndex removes user + following assistant", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    s.conversationHistory.push(
      { role: "user", content: "q1", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a1", timestamp: new Date().toISOString() },
      { role: "user", content: "q2", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a2", timestamp: new Date().toISOString() },
    );
    const r = deleteSessionMessagePairAtUiIndex(s, 0);
    expect(r.ok).toBe(true);
    expect(s.conversationHistory.map((m) => m.content)).toEqual(["q2", "a2"]);
  });

  it("deleteSessionMessagePairAtUiIndex on middle pair keeps later turns", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    s.conversationHistory.push(
      { role: "user", content: "q1", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a1", timestamp: new Date().toISOString() },
      { role: "user", content: "q2", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a2", timestamp: new Date().toISOString() },
      { role: "user", content: "q3", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a3", timestamp: new Date().toISOString() },
    );
    const r = deleteSessionMessagePairAtUiIndex(s, 2);
    expect(r.ok).toBe(true);
    expect(s.conversationHistory.map((m) => m.content)).toEqual(["q1", "a1", "q3", "a3"]);
  });

  it("deleting last assistant clears pendingRequiresAction", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    s.conversationHistory.push(
      { role: "user", content: "q1", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a1", timestamp: new Date().toISOString() },
      { role: "user", content: "q2", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a2", timestamp: new Date().toISOString() },
    );
    s.pendingRequiresAction = [
      {
        id: "ra-1",
        kind: "tool_approval",
        threadId: "t",
        title: "待批准",
        summary: "x",
        toolName: "execute_workflow",
        decisions: ["approve", "reject"],
        createdAt: new Date().toISOString(),
      },
    ];
    const r = deleteSessionMessagePairAtUiIndex(s, 3);
    expect(r.ok).toBe(true);
    expect(s.pendingRequiresAction).toBeUndefined();
    expect(s.conversationHistory.map((m) => m.content)).toEqual(["q1", "a1", "q2"]);
  });

  it("deleting earlier pair keeps pending owned by later assistant", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    s.conversationHistory.push(
      { role: "user", content: "q1", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a1", timestamp: new Date().toISOString() },
      { role: "user", content: "q2", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a2", timestamp: new Date().toISOString() },
    );
    s.pendingRequiresAction = [
      {
        id: "ra-2",
        kind: "tool_approval",
        threadId: "t",
        title: "待批准",
        summary: "x",
        toolName: "execute_workflow",
        decisions: ["approve", "reject"],
        createdAt: new Date().toISOString(),
      },
    ];
    const r = deleteSessionMessagePairAtUiIndex(s, 0);
    expect(r.ok).toBe(true);
    expect(s.pendingRequiresAction?.length).toBe(1);
  });
});
