import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendChatMessage,
  removeAssistantChatState,
  sendChatTurn,
} from "./lawmind-chat.js";

describe("lawmind-chat", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a chat turn and normalizes assistant message metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          sessionId: "session-1",
          reply: "已完成分析",
          memorySources: [
            {
              id: "matter_memory",
              label: "案件记忆",
              relativePath: "matters/matter-1/MEMORY.md",
              exists: true,
              charCount: 120,
              inAgentSystemPrompt: false,
            },
          ],
          toolCallSequence: ["search_cases", "", 3, "draft_memo"],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(
      sendChatTurn({
        apiBase: "http://127.0.0.1:4312",
        message: "请分析争议焦点",
        sessionId: "session-0",
        assistantId: "assistant-1",
        allowWebSearch: true,
        matterId: "matter-1",
        projectDir: "/tmp/project",
      }),
    ).resolves.toEqual({
      sessionId: "session-1",
      assistantMessage: {
        role: "assistant",
        text: "已完成分析",
        memorySources: [
          {
            id: "matter_memory",
            label: "案件记忆",
            relativePath: "matters/matter-1/MEMORY.md",
            exists: true,
            charCount: 120,
            inAgentSystemPrompt: false,
          },
        ],
        toolCallSequence: ["search_cases", "draft_memo"],
      },
    });
  });

  it("appends a chat message to the assistant thread", () => {
    expect(
      appendChatMessage(
        { assistantA: [{ role: "user", text: "hello" }] },
        "assistantA",
        { role: "assistant", text: "world" },
      ),
    ).toEqual({
      assistantA: [
        { role: "user", text: "hello" },
        { role: "assistant", text: "world" },
      ],
    });
  });

  it("removes assistant-specific session state", () => {
    expect(removeAssistantChatState({ assistantA: "session-1", assistantB: "session-2" }, "assistantA")).toEqual({
      assistantB: "session-2",
    });
  });
});
