import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyClaimedPinsToHistory,
  claimPendingContextPins,
  formatInjectedPinsUserMessage,
  queuePendingContextPins,
} from "./session-context-inject.js";
import type { AgentSession } from "./types.js";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-inject-"));
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

describe("session-context-inject", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("queues then claims pins from sidecar without touching session.json", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const sessionId = "s-inject-1";
    const queued = queuePendingContextPins(ws, sessionId, [
      { pinKind: "file", root: "workspace", relPath: "cases/m1/a.docx", kind: "file" },
    ]);
    expect(queued.pendingCount).toBe(1);
    expect(fs.existsSync(path.join(ws, "sessions", `${sessionId}.json`))).toBe(false);

    const claimed = claimPendingContextPins(ws, sessionId);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ pinKind: "file", relPath: "cases/m1/a.docx" });
    expect(claimPendingContextPins(ws, sessionId)).toEqual([]);
  });

  it("dedupes the same file pin", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const pin = {
      pinKind: "file" as const,
      root: "workspace" as const,
      relPath: "x.md",
      kind: "file" as const,
    };
    queuePendingContextPins(ws, "s2", [pin]);
    queuePendingContextPins(ws, "s2", [pin]);
    expect(claimPendingContextPins(ws, "s2")).toHaveLength(1);
  });

  it("appends a lawyer-facing user note so the next model round can read files", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const session = emptySession("s3");
    const pins = [
      {
        pinKind: "file" as const,
        root: "workspace" as const,
        relPath: "cases/m1/合同.docx",
        kind: "file" as const,
      },
    ];
    expect(applyClaimedPinsToHistory(session, ws, pins)).toBe(true);
    const last = session.conversationHistory[0];
    expect(last?.role).toBe("user");
    expect(last?.content).toContain("【本轮补充材料】");
    expect(last?.content).toContain("合同.docx");
    expect(last?.content).toMatch(/read_project_file|analyze_document/);
    expect(formatInjectedPinsUserMessage(ws, pins)).toContain("file:workspace:");
  });
});
