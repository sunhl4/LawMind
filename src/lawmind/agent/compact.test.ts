import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendQueueItem } from "../adapters/matter-storage/index.js";
import { persistDraft } from "../drafts/index.js";
import type { ArtifactDraft } from "../types.js";
import {
  autoCompactSessionHistory,
  buildDroppedSpanDigest,
  buildPostCompactSystemNote,
} from "./compact.js";
import type { AgentMessage, AgentSession } from "./types.js";

describe("buildDroppedSpanDigest", () => {
  it("extracts lawyer points, assistant replies, and tool names", () => {
    const dropped: AgentMessage[] = [
      { role: "user", content: "请审查违约金条款", timestamp: "t1" },
      {
        role: "assistant",
        content: "",
        timestamp: "t2",
        toolCalls: [{ id: "c1", name: "analyze_document", arguments: {} }],
      },
      {
        role: "tool",
        content: "{}",
        timestamp: "t3",
        toolCallResponses: [{ toolCallId: "c1", name: "analyze_document", result: { ok: true } }],
      },
      {
        role: "assistant",
        content: "建议将违约金上限改为合同总额的20%。",
        timestamp: "t4",
      },
    ];
    const digest = buildDroppedSpanDigest(dropped, 4_000);
    expect(digest).toContain("压缩前对话蒸馏");
    expect(digest).toContain("审查违约金");
    expect(digest).toContain("20%");
    expect(digest).toContain("analyze_document");
  });
});

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

  it("reinjects dropped-span digest when history is compacted by count", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compact-digest-"));
    const matterId = "m-digest";
    fs.mkdirSync(path.join(ws, "cases", matterId), { recursive: true });
    const history: AgentMessage[] = [
      { role: "system", content: "sys", timestamp: new Date().toISOString() },
    ];
    for (let i = 0; i < 12; i++) {
      history.push({
        role: "user",
        content: `律师问题 ${i}：关注付款节点`,
        timestamp: new Date().toISOString(),
      });
      history.push({
        role: "assistant",
        content: `助手回答 ${i}：建议分期付款。`,
        timestamp: new Date().toISOString(),
      });
    }
    const session: AgentSession = {
      sessionId: "s-digest",
      matterId,
      actorId: "test",
      turns: [],
      conversationHistory: history,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const out = autoCompactSessionHistory(session, ws, {
      maxHistoryMessages: 6,
      contextTokens: 128_000,
    });
    expect(out.compacted).toBe(true);
    expect(out.droppedDigest).toBeTruthy();
    expect(out.messages.some((m) => m.content?.includes("压缩前对话蒸馏"))).toBe(true);
    expect(fs.existsSync(path.join(ws, "cases", matterId, "compact-digest.md"))).toBe(true);
    const lastRealUser = [...out.messages]
      .toReversed()
      .find((m) => m.role === "user" && m.content.includes("律师问题"));
    const digestIdx = out.messages.findIndex((m) => m.content?.includes("压缩前对话蒸馏"));
    const lastUserIdx = out.messages.findIndex((m) => m === lastRealUser);
    expect(out.messages[0]?.role).toBe("system");
    expect(out.messages[0]?.content).toBe("sys");
    expect(out.messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(digestIdx).toBeGreaterThan(0);
    expect(digestIdx).toBeLessThan(lastUserIdx);
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
