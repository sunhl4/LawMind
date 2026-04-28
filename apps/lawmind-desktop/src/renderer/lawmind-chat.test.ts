import { afterEach, describe, expect, it, vi } from "vitest";
import { LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY } from "./lawmind-chat-diagnostics-pref.ts";
import {
  appendChatMessage,
  formatClarificationPromptSummary,
  formatClarificationReply,
  getPendingClarificationState,
  lastAssistantRuntimeHints,
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
          status: "awaiting_clarification",
          clarificationQuestions: [
            {
              key: "rent_and_deposit",
              question: "请补充租金、押金和支付周期。",
              reason: "核心商务条款缺失",
            },
          ],
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
          runtimeHints: {
            lawmindRouterMode: "model",
            lawmindReasoningMode: "graph",
            toolCallsExecuted: 2,
          },
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
        status: "awaiting_clarification",
        clarificationQuestions: [
          {
            key: "rent_and_deposit",
            question: "请补充租金、押金和支付周期。",
            reason: "核心商务条款缺失",
          },
        ],
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
        runtimeHints: {
          lawmindRouterMode: "model",
          lawmindReasoningMode: "graph",
          toolCallsExecuted: 2,
        },
      },
    });
  });

  it("lastAssistantRuntimeHints returns the latest assistant hints", () => {
    expect(
      lastAssistantRuntimeHints([
        { role: "user", text: "hi" },
        {
          role: "assistant",
          text: "a",
          runtimeHints: {
            lawmindRouterMode: "keyword",
            lawmindReasoningMode: "off",
            toolCallsExecuted: 1,
          },
        },
        { role: "user", text: "again" },
        {
          role: "assistant",
          text: "b",
          runtimeHints: {
            lawmindRouterMode: "model",
            lawmindReasoningMode: "on",
            toolCallsExecuted: 3,
          },
        },
      ]),
    ).toEqual({
      lawmindRouterMode: "model",
      lawmindReasoningMode: "on",
      toolCallsExecuted: 3,
    });
  });

  it("lastAssistantRuntimeHints ignores user messages and missing hints", () => {
    expect(
      lastAssistantRuntimeHints([
        { role: "user", text: "hi" },
        { role: "assistant", text: "no hints" },
      ]),
    ).toBeNull();
  });

  describe("sendChatTurn includeTurnDiagnostics", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("omits includeTurnDiagnostics when preference off", async () => {
      vi.stubGlobal("localStorage", {
        getItem: () => null,
        setItem: vi.fn(),
        removeItem: vi.fn(),
      });
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, reply: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      await sendChatTurn({
        apiBase: "http://127.0.0.1:9",
        message: "hi",
        assistantId: "a",
        allowWebSearch: false,
      });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.includeTurnDiagnostics).toBeUndefined();
    });

    it("sends includeTurnDiagnostics when preference on", async () => {
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => (k === LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY ? "1" : null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      });
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, reply: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      await sendChatTurn({
        apiBase: "http://127.0.0.1:9",
        message: "hi",
        assistantId: "a",
        allowWebSearch: false,
      });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.includeTurnDiagnostics).toBe(true);
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

  it("formats clarification replies for non-empty answers only", () => {
    expect(
      formatClarificationReply(
        [
          { key: "a", question: "Q1?", reason: "r1" },
          { key: "b", question: "Q2?" },
        ],
        { a: "  ", b: "答案二" },
      ),
    ).toBe(
      [
        "【补充信息】（请据此继续完善草稿并推进交付）",
        "",
        "### Q2?",
        "",
        "答案二",
        "",
        "请继续处理上述补充内容。",
      ].join("\n"),
    );
  });

  it("returns empty string when no answers filled", () => {
    expect(
      formatClarificationReply([{ key: "x", question: "Q?" }], { x: "   " }),
    ).toBe("");
  });

  it("builds a numbered prompt summary for the main input", () => {
    expect(formatClarificationPromptSummary([])).toBe("");
    expect(
      formatClarificationPromptSummary([
        { key: "a", question: "  One?  " },
        { key: "b", question: "Two?" },
      ]),
    ).toBe(["请按下面几点说明（可逐条写）：", "", "1. One?", "2. Two?", ""].join("\n"));
  });

  describe("getPendingClarificationState", () => {
    it("is not pending for empty list", () => {
      expect(getPendingClarificationState([])).toEqual({
        pending: false,
        count: 0,
        assistantMessageIndex: -1,
      });
    });

    it("is not pending when last message is user", () => {
      expect(
        getPendingClarificationState([
          { role: "assistant", text: "hi" },
          { role: "user", text: "ok" },
        ]),
      ).toEqual({ pending: false, count: 0, assistantMessageIndex: -1 });
    });

    it("is pending when last assistant has clarification questions", () => {
      const idx = 1;
      expect(
        getPendingClarificationState([
          { role: "user", text: "u" },
          {
            role: "assistant",
            text: "a",
            status: "awaiting_clarification",
            clarificationQuestions: [{ key: "k1", question: "Q1?" }],
          },
        ]),
      ).toEqual({ pending: true, count: 1, assistantMessageIndex: idx });
    });

    it("is pending on awaiting_clarification without structured questions", () => {
      const idx = 0;
      expect(
        getPendingClarificationState([{ role: "assistant", text: "a", status: "awaiting_clarification" }]),
      ).toEqual({ pending: true, count: 0, assistantMessageIndex: idx });
    });

    it("ignores clarification on non-final assistant (user replied after)", () => {
      expect(
        getPendingClarificationState([
          {
            role: "assistant",
            text: "old",
            clarificationQuestions: [{ key: "k", question: "Q?" }],
          },
          { role: "user", text: "replied" },
        ]),
      ).toEqual({ pending: false, count: 0, assistantMessageIndex: -1 });
    });

    it("is not pending when last assistant has no questions and is not awaiting", () => {
      expect(
        getPendingClarificationState([{ role: "assistant", text: "done", status: "completed" }]),
      ).toEqual({ pending: false, count: 0, assistantMessageIndex: -1 });
    });
  });

  it("removes assistant-specific session state", () => {
    expect(removeAssistantChatState({ assistantA: "session-1", assistantB: "session-2" }, "assistantA")).toEqual({
      assistantB: "session-2",
    });
  });
});
