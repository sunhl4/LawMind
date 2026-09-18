import { describe, expect, it } from "vitest";
import {
  applyToolDisclosureDelta,
  diffToolNames,
  formatToolDisclosureDeltaNote,
} from "./tool-disclosure-delta.js";
import type { AgentSession } from "./types.js";

function emptySession(): AgentSession {
  return {
    sessionId: "s1",
    actorId: "lawyer",
    turns: [],
    conversationHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("tool-disclosure-delta", () => {
  it("diffs added and removed tool names", () => {
    expect(diffToolNames(["a", "b"], ["b", "c"])).toEqual({
      added: ["c"],
      removed: ["a"],
    });
  });

  it("formats a note only when the set changes", () => {
    expect(formatToolDisclosureDeltaNote({ added: [], removed: [] })).toBeNull();
    const note = formatToolDisclosureDeltaNote({
      added: ["web_search"],
      removed: ["draft_document"],
    });
    expect(note).toContain("新增：web_search");
    expect(note).toContain("移除：draft_document");
  });

  it("skips the first round and appends a hidden note on later deltas", () => {
    const session = emptySession();
    expect(applyToolDisclosureDelta(session, null, ["a", "b"])).toBeNull();
    expect(session.conversationHistory).toHaveLength(0);
    const delta = applyToolDisclosureDelta(session, ["a", "b"], ["a", "c"]);
    expect(delta).toEqual({ added: ["c"], removed: ["b"] });
    expect(session.conversationHistory).toHaveLength(1);
    expect(session.conversationHistory[0]?.hiddenFromLawyer).toBe(true);
    expect(session.conversationHistory[0]?.content).toContain("新增：c");
  });
});
