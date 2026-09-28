import { describe, expect, it } from "vitest";
import { getPendingClarificationState } from "./lawmind-chat.js";

describe("lawmind-chat-shell", () => {
  it("does not treat memory-source payloads as chat chrome (panel removed from bubbles)", () => {
    // Regression: assistant bubbles must stay Codex/Cursor-clean — no footer
    // "cited materials" strip. Clarification remains the only pending gate here.
    const state = getPendingClarificationState([
      {
        role: "assistant",
        text: "reply",
        toolCallSequence: ["search", "draft"],
      },
    ]);
    expect(state.pending).toBe(false);
  });
});
