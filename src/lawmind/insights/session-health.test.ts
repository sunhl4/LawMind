import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendQueueItem } from "../adapters/matter-storage/index.js";
import { saveSession } from "../agent/session.js";
import type { AgentSession } from "../agent/types.js";
import { buildWorkspaceSessionHealth } from "./session-health.js";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-session-health-"));
}

describe("buildWorkspaceSessionHealth", () => {
  it("returns good score for empty workspace", () => {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, "sessions"), { recursive: true });
    const r = buildWorkspaceSessionHealth(ws);
    expect(r.grade).toBe("good");
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.signals).toHaveLength(0);
  });

  it("penalizes pending requires-action on sessions", () => {
    const ws = tmpWs();
    const now = new Date().toISOString();
    const session: AgentSession = {
      sessionId: "s1",
      actorId: "test",
      assistantId: "a1",
      matterId: "m1",
      createdAt: now,
      updatedAt: now,
      turns: [],
      conversationHistory: [],
      pendingRequiresAction: [
        {
          id: "ra1",
          kind: "tool_approval",
          threadId: "m1::s1",
          title: "批准",
          summary: "test",
          decisions: ["approve", "reject"],
          createdAt: now,
        },
      ],
    };
    saveSession(ws, session);
    const r = buildWorkspaceSessionHealth(ws);
    expect(r.signals.some((s) => s.id === "chat_pending_actions")).toBe(true);
    expect(r.score).toBeLessThan(100);
  });

  it("signals open queue items with blockedReason", () => {
    const ws = tmpWs();
    const now = new Date().toISOString();
    appendQueueItem(ws, {
      queueItemId: "q-block-1",
      matterId: "m-block",
      kind: "need_evidence",
      status: "open",
      priority: "high",
      title: "待证据",
      blockedReason: "缺少对方合同原件",
      createdAt: now,
      updatedAt: now,
    });
    const r = buildWorkspaceSessionHealth(ws);
    expect(r.signals.some((s) => s.id === "queue_blocked")).toBe(true);
  });
});
