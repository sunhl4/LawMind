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

  it("lockToAllowNames keeps playbook tools and drops disclosed search", () => {
    const registry = new ToolRegistry();
    for (const name of [
      "analyze_document",
      "update_draft",
      "search_workspace",
      "list_more_tools",
    ]) {
      registry.register({
        definition: { name, description: name, category: "system", parameters: {} },
        async execute() {
          return { ok: true };
        },
      });
    }
    const session: AgentSession = {
      sessionId: "s",
      actorId: "a",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      disclosedToolNames: ["search_workspace"],
    };
    const step = rebuildStepContext({
      session,
      registry,
      turnContext: freezeTurnContext({
        sessionId: "s",
        turnId: "t",
        permissionMode: "standard",
        model: "demo",
        actorId: "a",
        sandboxEnabled: false,
        allowNames: ["analyze_document", "update_draft"],
        lockToAllowNames: true,
      }),
    });
    expect(step.toolNames).toEqual(["analyze_document", "update_draft"]);
  });

  it("drops a successful analyze_document from later Word-revision rounds", () => {
    const registry = new ToolRegistry();
    for (const name of [
      "analyze_document",
      "read_project_file",
      "update_draft",
      "apply_surgical_edits",
      "render_tracked_draft",
    ]) {
      registry.register({
        definition: { name, description: name, category: "system", parameters: {} },
        async execute() {
          return { ok: true };
        },
      });
    }
    const session: AgentSession = {
      sessionId: "s",
      actorId: "a",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const turnContext = freezeTurnContext({
      sessionId: "s",
      turnId: "t",
      permissionMode: "standard",
      model: "demo",
      actorId: "a",
      sandboxEnabled: false,
      allowNames: [
        "analyze_document",
        "read_project_file",
        "update_draft",
        "apply_surgical_edits",
        "render_tracked_draft",
      ],
      lockToAllowNames: true,
      wordRevisionTurn: true,
    });
    const afterRead = rebuildStepContext({
      session,
      registry,
      turnContext,
      discoveryCallCounts: { analyze_document: 1 },
    });
    expect(afterRead.toolNames).not.toContain("analyze_document");
    expect(afterRead.toolNames).not.toContain("read_project_file");
    expect(afterRead.toolNames).toEqual([
      "apply_surgical_edits",
      "render_tracked_draft",
      "update_draft",
    ]);

    const firstRound = rebuildStepContext({ session, registry, turnContext });
    expect(firstRound.toolNames).toContain("analyze_document");
    expect(firstRound.toolNames).toContain("read_project_file");
  });
});
