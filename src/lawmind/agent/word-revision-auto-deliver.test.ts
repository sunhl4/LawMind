import { describe, expect, it } from "vitest";
import type { AgentContext, AgentTurn } from "./types.js";
import { shouldAutoDeliverWordRevision } from "./word-revision-auto-deliver.js";

function turn(status: AgentTurn["status"]): AgentTurn {
  return {
    turnId: "t1",
    sessionId: "s1",
    instruction: "改这份",
    status,
    startedAt: "t",
  } as AgentTurn;
}

function ctx(partial: Partial<AgentContext> = {}): AgentContext {
  return {
    workspaceDir: "/tmp/ws",
    sessionId: "s1",
    wordRevisionTurn: true,
    permissionMode: "standard",
    ...partial,
  } as AgentContext;
}

describe("shouldAutoDeliverWordRevision", () => {
  it("runs only after a completed writable turn", () => {
    expect(shouldAutoDeliverWordRevision({ ctx: ctx(), turn: turn("completed") })).toBe(true);
  });

  it("does not write while clarifying, paused, or awaiting approval", () => {
    expect(
      shouldAutoDeliverWordRevision({ ctx: ctx(), turn: turn("awaiting_clarification") }),
    ).toBe(false);
    expect(shouldAutoDeliverWordRevision({ ctx: ctx(), turn: turn("paused") })).toBe(false);
    expect(shouldAutoDeliverWordRevision({ ctx: ctx(), turn: turn("awaiting_approval") })).toBe(
      false,
    );
  });

  it("does not write in readonly or research mode", () => {
    expect(
      shouldAutoDeliverWordRevision({
        ctx: ctx({ permissionMode: "readonly" }),
        turn: turn("completed"),
      }),
    ).toBe(false);
    expect(
      shouldAutoDeliverWordRevision({
        ctx: ctx({ permissionMode: "research" }),
        turn: turn("completed"),
      }),
    ).toBe(false);
  });

  it("does not write when the model already exported a tracked draft", () => {
    const t = turn("completed");
    t.toolNameCallCounts = { render_tracked_draft: 1 };
    expect(shouldAutoDeliverWordRevision({ ctx: ctx(), turn: t })).toBe(false);
  });
});
