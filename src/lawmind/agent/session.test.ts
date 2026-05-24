import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTO_CHAT_TITLE_MAX_LENGTH,
  createSession,
  DEFAULT_CHAT_SESSION_TITLE,
  deleteSession,
  deriveAutoChatTitleFromFirstUserMessage,
  displayChatSessionTitle,
  extractFirstSentenceFromUserMessageParagraph,
  maybeUpdateSessionTitleFromInstruction,
  renameSession,
  sessionHistoryToSimpleMessages,
} from "./session.js";
import type { AgentSession } from "./types.js";

function tmpDir(): string {
  const dir = path.join(process.cwd(), "tmp", `lawmind-session-test-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("session title and history helpers", () => {
  it("createSession sets default title New Chat", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    expect(s.title).toBe(DEFAULT_CHAT_SESSION_TITLE);
    expect(displayChatSessionTitle(s)).toBe("New Chat");
  });

  it("displayChatSessionTitle falls back for legacy sessions", () => {
    expect(displayChatSessionTitle({ title: "" } as AgentSession)).toBe("New Chat");
    expect(displayChatSessionTitle({} as AgentSession)).toBe("New Chat");
  });

  it("extractFirstSentenceFromUserMessageParagraph stops at sentence end", () => {
    expect(extractFirstSentenceFromUserMessageParagraph("Hello world. Second part")).toBe(
      "Hello world.",
    );
    expect(extractFirstSentenceFromUserMessageParagraph("第一句。第二句")).toBe("第一句。");
    expect(extractFirstSentenceFromUserMessageParagraph("How are you? Fine.")).toBe("How are you?");
  });

  it("deriveAutoChatTitleFromFirstUserMessage uses first paragraph and first sentence", () => {
    expect(deriveAutoChatTitleFromFirstUserMessage("Intro line.\n\nSecond paragraph.")).toBe(
      "Intro line.",
    );
    expect(deriveAutoChatTitleFromFirstUserMessage("无句号一整段")).toBe("无句号一整段");
    expect(AUTO_CHAT_TITLE_MAX_LENGTH).toBe(72);
  });

  it("maybeUpdateSessionTitleFromInstruction uses first sentence of hint", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a", title: "New Chat" });
    expect(maybeUpdateSessionTitleFromInstruction(s, "ignored", "你好。请帮我审合同。")).toBe(true);
    expect(s.title).toBe("你好。");
    expect(maybeUpdateSessionTitleFromInstruction(s, "other", "x")).toBe(false);
  });

  it("maybeUpdate skips LawMind prefix when no hint", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a", title: "New Chat" });
    const instruction = `【用户在 LawMind 文件页将下列路径标为「本回合重点」】\n- [工作区 · 文件] \`a.md\`\n\n真正的问题在这里展开`;
    expect(maybeUpdateSessionTitleFromInstruction(s, instruction)).toBe(true);
    expect(s.title).toBe("真正的问题在这里展开");
  });

  it("deleteSession removes json and turns files", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    const turns = path.join(ws, "sessions", `${s.sessionId}.turns.jsonl`);
    fs.writeFileSync(turns, "{}\n", "utf8");
    expect(deleteSession(ws, s.sessionId)).toBe(true);
    expect(fs.existsSync(path.join(ws, "sessions", `${s.sessionId}.json`))).toBe(false);
    expect(fs.existsSync(turns)).toBe(false);
    expect(deleteSession(ws, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("renameSession updates persisted file", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    const updated = renameSession(ws, s.sessionId, "  My matter  ");
    expect(updated?.title).toBe("My matter");
    const loaded = JSON.parse(
      fs.readFileSync(path.join(ws, "sessions", `${s.sessionId}.json`), "utf8"),
    ) as AgentSession;
    expect(loaded.title).toBe("My matter");
  });

  it("sessionHistoryToSimpleMessages maps user and assistant only", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    s.conversationHistory.push(
      { role: "system", content: "x", timestamp: new Date().toISOString() },
      { role: "user", content: " hi ", timestamp: new Date().toISOString() },
      { role: "assistant", content: "yo", timestamp: new Date().toISOString() },
    );
    const rows = sessionHistoryToSimpleMessages(s);
    expect(rows).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "yo" },
    ]);
  });

  it("sessionHistoryToSimpleMessages includes persisted liveTrace", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    s.conversationHistory.push(
      { role: "user", content: "task", timestamp: new Date().toISOString() },
      {
        role: "assistant",
        content: "done",
        timestamp: new Date().toISOString(),
        liveTrace: {
          currentRound: 1,
          steps: [{ id: "t1", kind: "tool", label: "执行工作流", status: "done" }],
        },
      },
    );
    const rows = sessionHistoryToSimpleMessages(s);
    expect(rows[1]?.liveTrace?.active).toBe(false);
    expect(rows[1]?.liveTrace?.steps[0]?.label).toBe("执行工作流");
  });

  it("sessionHistoryToSimpleMessages attaches pendingRequiresAction to last assistant", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    s.conversationHistory.push(
      { role: "user", content: "go", timestamp: new Date().toISOString() },
      { role: "assistant", content: "wait", timestamp: new Date().toISOString() },
    );
    s.pendingRequiresAction = [
      {
        id: "ra-1",
        kind: "tool_approval",
        threadId: "t1",
        title: "approve",
        summary: "s",
        toolName: "execute_workflow",
        toolArgs: {},
        decisions: ["approve", "reject"],
        createdAt: new Date().toISOString(),
      },
    ];
    const rows = sessionHistoryToSimpleMessages(s);
    expect(rows[1]?.requiresAction?.[0]?.id).toBe("ra-1");
  });

  it("sessionHistoryToSimpleMessages keeps trace-only assistant rows", () => {
    const ws = tmpDir();
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    s.conversationHistory.push(
      { role: "user", content: "task", timestamp: new Date().toISOString() },
      {
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        liveTrace: {
          currentRound: 1,
          steps: [{ id: "t1", kind: "tool", label: "写回草稿", status: "running" }],
        },
      },
    );
    const rows = sessionHistoryToSimpleMessages(s);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.text).toBe("");
    expect(rows[1]?.liveTrace?.steps[0]?.label).toBe("写回草稿");
  });
});
