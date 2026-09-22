import { describe, expect, it } from "vitest";
import type { AgentContext, AgentSession } from "../agent/types.js";
import { buildContextPlan, buildContextPlanMarkdown } from "./context-plan.js";

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: "session-1",
    matterId: "matter-1",
    actorId: "lawyer",
    turns: [],
    conversationHistory: [
      { role: "user", content: "审查合同", timestamp: "2026-01-01T00:00:00.000Z" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function ctx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    workspaceDir: "/tmp/lawmind",
    sessionId: "session-1",
    matterId: "matter-1",
    actorId: "lawyer",
    ...overrides,
  };
}

describe("ContextPlan", () => {
  it("prioritizes matter state and strategy over transcript", () => {
    const plan = buildContextPlan({ session: session(), ctx: ctx() });
    const matter = plan.layers.find((layer) => layer.id === "matter_state");
    const transcript = plan.layers.find((layer) => layer.id === "recent_transcript");
    expect(matter?.included).toBe(true);
    expect(transcript?.included).toBe(true);
    expect((matter?.priority ?? 0) > (transcript?.priority ?? 0)).toBe(true);
  });

  it("surfaces pending lawyer actions", () => {
    const plan = buildContextPlan({
      session: session({ pendingClarificationKeys: ["client-goal"] }),
      ctx: ctx(),
    });
    const pending = plan.layers.find((layer) => layer.id === "pending_actions");
    expect(pending?.included).toBe(true);
    expect(pending?.evidence).toContain("clarification:client-goal");
  });

  it("renders a readable markdown plan", () => {
    const markdown = buildContextPlanMarkdown(buildContextPlan({ session: session(), ctx: ctx() }));
    expect(markdown).toContain("LawMind Context Plan");
    expect(markdown).toContain("Matter state");
  });

  it("includes pinned_context layer when pins are present", () => {
    const plan = buildContextPlan({
      session: session(),
      ctx: ctx(),
      pinnedContext: {
        included: true,
        evidence: ["theory:cases/matter-1/MATTER_STRATEGY.md"],
        markdownBlock: "## pinned",
      },
    });
    const pinned = plan.layers.find((layer) => layer.id === "pinned_context");
    expect(pinned?.included).toBe(true);
    expect(pinned?.evidence).toContain("theory:cases/matter-1/MATTER_STRATEGY.md");
    const markdown = buildContextPlanMarkdown(plan);
    expect(markdown).toContain("Pinned truth sources");
  });
});
