import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import type { AgentContext, AgentSession } from "../agent/types.js";
import { buildContextPlan, buildContextPlanMarkdown } from "./context-plan.js";

function session(): AgentSession {
  return {
    sessionId: "s-int",
    matterId: "m-int",
    actorId: "lawyer",
    turns: [],
    conversationHistory: [
      { role: "user", content: "审查合同违约金", timestamp: "2026-01-01T00:00:00.000Z" },
    ],
    pendingClarificationKeys: ["fee-scope"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function ctx(): AgentContext {
  return {
    workspaceDir: "/tmp/ws",
    sessionId: "s-int",
    matterId: "m-int",
    actorId: "lawyer",
  };
}

describe("ContextPlan runtime integration", () => {
  it("markdown includes matter, pending actions, and transcript layers", () => {
    const plan = buildContextPlan({ session: session(), ctx: ctx() });
    const md = buildContextPlanMarkdown(plan);
    expect(md).toContain("Matter state");
    expect(md).toContain("Pending lawyer actions");
    expect(md).toContain("Recent transcript");
    expect(md).toContain("clarification:fee-scope");
  });

  it("buildSystemPrompt embeds ContextPlan section when provided", () => {
    const planMd = buildContextPlanMarkdown(buildContextPlan({ session: session(), ctx: ctx() }));
    const prompt = buildSystemPrompt({
      availableTools: [],
      contextPlanMarkdown: planMd,
    });
    expect(prompt).toContain("上下文计划（ContextPlan）");
    expect(prompt).toContain("clarification:fee-scope");
  });
});
