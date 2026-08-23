import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./tools/registry.js";
import { freezeTurnContext, rebuildStepContext } from "./turn-step-context.js";
import type { AgentSession } from "./types.js";

describe("turn-step-context", () => {
  it("freezeTurnContext copies allowNames so later mutation cannot widen the turn", () => {
    const allowNames = ["analyze_document"];
    const frozen = freezeTurnContext({
      sessionId: "s",
      turnId: "t",
      permissionMode: "readonly",
      model: "demo",
      actorId: "a",
      sandboxEnabled: false,
      allowNames,
    });
    allowNames.push("write_document");
    expect(frozen.allowNames).toEqual(["analyze_document"]);
    expect(frozen.permissionMode).toBe("readonly");
  });

  it("rebuildStepContext uses frozen permissionMode, not a later session disclose of writes", () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "analyze_document",
        description: "r",
        category: "analyze",
        parameters: {},
      },
      async execute() {
        return { ok: true };
      },
    });
    registry.register({
      definition: {
        name: "write_document",
        description: "w",
        category: "draft",
        parameters: {},
      },
      async execute() {
        return { ok: true };
      },
    });
    registry.register({
      definition: {
        name: "list_more_tools",
        description: "more",
        category: "system",
        parameters: {},
      },
      async execute() {
        return { ok: true };
      },
    });
    const session: AgentSession = {
      sessionId: "s",
      actorId: "a",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      disclosedToolNames: ["write_document"],
    };
    const step = rebuildStepContext({
      session,
      registry,
      turnContext: freezeTurnContext({
        sessionId: "s",
        turnId: "t",
        permissionMode: "readonly",
        model: "demo",
        actorId: "a",
        sandboxEnabled: false,
      }),
    });
    expect(step.toolNames).toContain("analyze_document");
    expect(step.toolNames).not.toContain("write_document");
  });
});
