import { describe, expect, it } from "vitest";
import { hasChatDiagnostics } from "./lawmind-chat-shell.js";

describe("lawmind-chat-shell", () => {
  it("shows diagnostics when memory sources exist", () => {
    expect(
      hasChatDiagnostics({
        role: "assistant",
        text: "reply",
        memorySources: [
          {
            id: "matter_memory",
            label: "案件记忆",
            relativePath: "matters/m-1/MEMORY.md",
            exists: true,
            charCount: 42,
            inAgentSystemPrompt: false,
          },
        ],
      }),
    ).toBe(true);
  });

  it("shows diagnostics when tool call sequence exists", () => {
    expect(
      hasChatDiagnostics({
        role: "assistant",
        text: "reply",
        toolCallSequence: ["search", "draft"],
      }),
    ).toBe(true);
  });

  it("hides diagnostics when neither source is present", () => {
    expect(
      hasChatDiagnostics({
        role: "assistant",
        text: "reply",
      }),
    ).toBe(false);
  });
});
