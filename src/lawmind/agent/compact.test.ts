import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendQueueItem } from "../adapters/matter-storage/index.js";
import { persistDraft } from "../drafts/index.js";
import type { ArtifactDraft } from "../types.js";
import { autoCompactSessionHistory, buildPostCompactSystemNote } from "./compact.js";
import type { AgentSession } from "./types.js";

describe("autoCompactSessionHistory", () => {
  it("preserves tool_use/tool_result pairs at boundary", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compact-"));
    const session: AgentSession = {
      sessionId: "s1",
      actorId: "test",
      turns: [],
      conversationHistory: [
        { role: "system", content: "sys", timestamp: new Date().toISOString() },
        { role: "user", content: "u1", timestamp: new Date().toISOString() },
        {
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
          toolCalls: [{ id: "t1", name: "search_workspace", arguments: {} }],
        },
        {
          role: "tool",
          content: "{}",
          timestamp: new Date().toISOString(),
          toolCallResponses: [{ toolCallId: "t1", name: "search_workspace", result: { ok: true } }],
        },
        { role: "assistant", content: "done", timestamp: new Date().toISOString() },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const out = autoCompactSessionHistory(session, ws, { maxHistoryMessages: 4 });
    expect(out.compacted).toBe(true);
    const roles = out.messages.map((m) => m.role).join(",");
    expect(roles).toContain("tool");
  });

  it("buildPostCompactSystemNote includes draft and queue attachments", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compact-att-"));
    const matterId = "m-att";
    const taskId = "task-att-1";
    const now = new Date().toISOString();
    persistDraft(ws, {
      taskId,
      matterId,
      title: "测试草稿",
      output: "docx",
      summary: "摘要",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    } as ArtifactDraft);
    appendQueueItem(ws, {
      queueItemId: "q1",
      matterId,
      kind: "need_lawyer_review",
      status: "open",
      priority: "high",
      title: "律师复核",
      createdAt: now,
      updatedAt: now,
    });
    const note = buildPostCompactSystemNote({
      matterId,
      linkedTaskId: taskId,
      workspaceDir: ws,
    });
    expect(note).toContain("关联草稿");
    expect(note).toContain("待办队列");
  });
});
