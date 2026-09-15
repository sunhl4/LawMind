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

  it("denyNames drops rebuild tools from an unlocked step catalog", () => {
    const registry = new ToolRegistry();
    for (const name of [
      "analyze_document",
      "render_document",
      "search_workspace",
      "list_more_tools",
      "update_plan",
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
        denyNames: ["render_document"],
      }),
    });
    expect(step.toolNames).toContain("analyze_document");
    expect(step.toolNames).toContain("search_workspace");
    expect(step.toolNames).toContain("list_more_tools");
    expect(step.toolNames).not.toContain("render_document");
  });

  it("keeps document readers after a successful Word-revision read", () => {
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
    expect(afterRead.toolNames).toContain("analyze_document");
    expect(afterRead.toolNames).toContain("read_project_file");
    expect(afterRead.toolNames).toContain("apply_surgical_edits");
    expect(afterRead.toolNames).toContain("render_tracked_draft");
    expect(afterRead.toolNames).toContain("update_draft");

    const firstRound = rebuildStepContext({ session, registry, turnContext });
    expect(firstRound.toolNames).toContain("analyze_document");
    expect(firstRound.toolNames).toContain("read_project_file");
  });

  it("lockToAllowNames still advertises update_plan when the tool is registered", () => {
    const registry = new ToolRegistry();
    for (const name of ["analyze_document", "update_draft", "update_plan"]) {
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
    expect(step.toolNames).toEqual(["analyze_document", "update_draft", "update_plan"]);
  });

  it("keeps analyze_document after one read; host-file ledger keeps it past the discovery cap", () => {
    const registry = new ToolRegistry();
    for (const name of ["analyze_document", "read_project_file", "update_draft", "list_dir"]) {
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
      disclosedToolNames: ["list_dir"],
    };
    const turnContext = freezeTurnContext({
      sessionId: "s",
      turnId: "t",
      permissionMode: "standard",
      model: "demo",
      actorId: "a",
      sandboxEnabled: false,
    });
    const afterOne = rebuildStepContext({
      session,
      registry,
      turnContext,
      discoveryCallCounts: { analyze_document: 1 },
    });
    expect(afterOne.toolNames).toContain("analyze_document");

    const saturated = rebuildStepContext({
      session,
      registry,
      turnContext,
      discoveryCallCounts: { analyze_document: 8 },
    });
    expect(saturated.toolNames).not.toContain("analyze_document");

    const ledger = rebuildStepContext({
      session,
      registry,
      turnContext,
      discoveryCallCounts: { analyze_document: 8 },
      hostFileLedger: true,
    });
    expect(ledger.toolNames).toContain("analyze_document");
    expect(ledger.toolNames).toContain("list_dir");
  });
});
