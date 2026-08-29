import { describe, expect, it } from "vitest";
import { inspectSessionHistoryAlignment } from "./session-history-alignment.js";
import type { AgentSession, AgentTurn } from "./types.js";

function session(history: AgentSession["conversationHistory"]): AgentSession {
  return {
    sessionId: "s1",
    actorId: "a",
    turns: [],
    conversationHistory: history,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("inspectSessionHistoryAlignment", () => {
  it("accepts matching derive / events final / turn instruction", () => {
    const s = session([
      { role: "system", content: "rules", timestamp: "t0" },
      { role: "user", content: "请审这份合同", timestamp: "t1" },
      { role: "assistant", content: "已改管辖条款。", timestamp: "t2" },
    ]);
    const turn: AgentTurn = {
      turnId: "t1",
      sessionId: "s1",
      instruction: "请审这份合同",
      messages: [],
      toolCallsExecuted: 0,
      status: "completed",
      startedAt: "t1",
    };
    expect(
      inspectSessionHistoryAlignment({
        session: s,
        events: [
          { t: "t1", event: { type: "turn_begin" } },
          { t: "t2", event: { type: "final", status: "completed", reply: "已改管辖条款。" } },
        ],
        turns: [turn],
      }).ok,
    ).toBe(true);
  });

  it("flags final reply drift and missing turn instruction", () => {
    const s = session([
      { role: "user", content: "别的问题", timestamp: "t1" },
      { role: "assistant", content: "律师看见的回复", timestamp: "t2" },
    ]);
    const drifted = inspectSessionHistoryAlignment({
      session: s,
      events: [
        { t: "t1", event: { type: "turn_begin" } },
        { t: "t2", event: { type: "final", status: "completed", reply: "模型落盘的另一句" } },
      ],
      turns: [
        {
          turnId: "t9",
          sessionId: "s1",
          instruction: "请审这份合同",
          messages: [],
          toolCallsExecuted: 0,
          status: "completed",
          startedAt: "t1",
        },
      ],
    });
    expect(drifted.ok).toBe(false);
    expect(drifted.issues.map((issue) => issue.code).toSorted()).toEqual([
      "final_reply_mismatch",
      "turn_instruction_missing",
    ]);
  });

  it("does not require events or turns for a clean history", () => {
    const s = session([{ role: "user", content: "hi", timestamp: "t1" }]);
    expect(inspectSessionHistoryAlignment({ session: s }).ok).toBe(true);
  });
});
