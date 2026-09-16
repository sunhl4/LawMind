import { describe, expect, it } from "vitest";
import type { AgentConfig, AgentContext } from "../../types.js";
import { createConsultAssistantTool } from "./handoff.js";

function buildContext(): AgentContext {
  return {
    workspaceDir: "/tmp/lawmind-consult",
    sessionId: "test-session",
    actorId: "lawyer-x",
    assistantId: "self",
    projectDir: undefined,
    allowWebSearch: false,
    collaborationEnabled: true,
    clarificationBlockingHeavyTools: false,
    strictDangerousToolApproval: false,
  } as AgentContext;
}

function buildBaseConfig(): AgentConfig {
  return {
    workspaceDir: "/tmp/lawmind-consult",
    model: {
      baseUrl: "http://127.0.0.1:9999",
      apiKey: "test",
      model: "test-model",
    },
  } as AgentConfig;
}

describe("coordination/consult_assistant", () => {
  it("rejects a vague 帮我看看 without a self-contained brief", async () => {
    const tool = createConsultAssistantTool({ baseConfig: buildBaseConfig() });
    const result = await tool.execute(
      { target_assistant: "anyone", question: "帮我看看" },
      buildContext(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/任务书不完整/);
  });

  it("schema requires a self-contained question and optional brief fields", () => {
    const tool = createConsultAssistantTool({ baseConfig: buildBaseConfig() });
    const keys = Object.keys(tool.definition.parameters);
    expect(keys).toEqual(
      expect.arrayContaining(["target_assistant", "question", "goal", "not_goal", "materials"]),
    );
  });
});
