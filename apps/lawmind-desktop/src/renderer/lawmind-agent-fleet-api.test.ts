import { describe, expect, it } from "vitest";
import { matchNeedsDecisionFocusId } from "./lawmind-agent-fleet-api";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";

function run(partial: Partial<AgentRunSummary> & Pick<AgentRunSummary, "id" | "status">): AgentRunSummary {
  return {
    kind: "chat",
    title: "t",
    priority: 0,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("matchNeedsDecisionFocusId", () => {
  const queue = [
    run({ id: "chat:s-other", status: "awaiting_approval", sessionId: "s-other" }),
    run({
      id: "chat:s-clarify",
      status: "awaiting_clarification",
      sessionId: "s-clarify",
    }),
    run({ id: "review:t-1", status: "awaiting_review", taskId: "t-1", kind: "pending_review" }),
  ];

  it("matches by sessionId for clarification deep-link", () => {
    expect(
      matchNeedsDecisionFocusId(queue, {
        sessionId: "s-clarify",
        preferStatus: "awaiting_clarification",
      }),
    ).toBe("chat:s-clarify");
  });

  it("matches by taskId for pending review", () => {
    expect(matchNeedsDecisionFocusId(queue, { taskId: "t-1" })).toBe("review:t-1");
  });

  it("falls back to preferStatus", () => {
    expect(
      matchNeedsDecisionFocusId(queue, { preferStatus: "awaiting_clarification" }),
    ).toBe("chat:s-clarify");
  });

  it("does not fall back to preferStatus when sessionId is missing from queue", () => {
    expect(
      matchNeedsDecisionFocusId(queue, {
        sessionId: "s-missing",
        preferStatus: "awaiting_clarification",
      }),
    ).toBeNull();
  });
});
