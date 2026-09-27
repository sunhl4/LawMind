import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSession,
  listSessions,
  listSessionsForDesk,
  loadSession,
  saveSession,
} from "./session.js";

describe("listSessionsForDesk", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const dir of tmp) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips conversation history and does not replace the full session", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-session-desk-"));
    tmp.push(workspaceDir);
    const session = createSession({ workspaceDir, actorId: "lawyer", title: "租赁纠纷" });
    session.conversationHistory = [
      { role: "user", content: '保留这段 "原文" {不要丢}' },
      { role: "assistant", content: "答复" },
    ];
    session.turns = [
      {
        turnId: "turn-1",
        sessionId: session.sessionId,
        instruction: "问违约金",
        messages: [],
        toolCallsExecuted: 0,
        status: "completed",
        startedAt: session.createdAt,
      },
    ];
    session.pendingRequiresAction = [
      {
        id: "act-1",
        kind: "clarification",
        threadId: "thread-1",
        title: "补一句",
        summary: "缺对方名称",
        decisions: ["respond"],
        createdAt: session.createdAt,
      },
    ];
    saveSession(workspaceDir, session);

    const desk = listSessionsForDesk(workspaceDir);
    expect(desk).toHaveLength(1);
    expect(desk[0]?.conversationHistory).toEqual([]);
    expect(desk[0]?.title).toBe("租赁纠纷");
    expect(desk[0]?.turns[0]?.instruction).toBe("问违约金");
    expect(desk[0]?.pendingRequiresAction?.[0]?.id).toBe("act-1");

    const full = listSessions(workspaceDir);
    expect(full).toHaveLength(1);
    expect(full[0]?.conversationHistory.map((message) => message.content)).toEqual([
      '保留这段 "原文" {不要丢}',
      "答复",
    ]);
    expect(loadSession(workspaceDir, session.sessionId)?.conversationHistory).toHaveLength(2);

    fs.writeFileSync(
      path.join(workspaceDir, "sessions", `${session.sessionId}.json`),
      "{not-json",
      "utf8",
    );
    const fromIndex = listSessionsForDesk(workspaceDir);
    expect(fromIndex[0]?.title).toBe("租赁纠纷");
    expect(fromIndex[0]?.conversationHistory).toEqual([]);
  });
});
