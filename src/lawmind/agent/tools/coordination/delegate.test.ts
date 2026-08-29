import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertAssistant } from "../../../assistants/store.js";
import type { AgentConfig, AgentContext } from "../../types.js";
import { createDelegateTaskTool, createDelegateToRoleTool } from "./delegate.js";
import { findAssistantsByRole } from "./utils.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-delegate-role-"));
}

function buildContext(workspaceDir: string, assistantId: string): AgentContext {
  return {
    workspaceDir,
    sessionId: "test-session",
    actorId: "lawyer-x",
    assistantId,
    projectDir: undefined,
    allowWebSearch: false,
    collaborationEnabled: true,
    clarificationBlockingHeavyTools: false,
    strictDangerousToolApproval: false,
  } as AgentContext;
}

function buildBaseConfig(workspaceDir: string): AgentConfig {
  return {
    workspaceDir,
    model: {
      baseUrl: "http://127.0.0.1:9999",
      apiKey: "test",
      model: "test-model",
    },
  } as AgentConfig;
}

let tmp = "";

beforeEach(() => {
  tmp = tmpRoot();
});

afterEach(() => {
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

describe("coordination/delegate", () => {
  it("findAssistantsByRole prefers roleId then falls back to presetKey", () => {
    const ws = path.join(tmp, "workspace");
    fs.mkdirSync(ws, { recursive: true });
    upsertAssistant(tmp, {
      assistantId: "a-1",
      displayName: "Alice",
      introduction: "",
      presetKey: "contract_review",
    });
    upsertAssistant(tmp, {
      assistantId: "a-2",
      displayName: "Bob",
      introduction: "",
      roleId: "contract_review",
    });
    const matches = findAssistantsByRole(ws, "contract_review");
    // The roleId match should be preferred when present
    expect(matches.map((m) => m.assistantId)).toContain("a-2");
  });

  it("delegate_to_role rejects unknown role", async () => {
    const ws = path.join(tmp, "workspace");
    fs.mkdirSync(ws, { recursive: true });
    upsertAssistant(tmp, {
      assistantId: "self",
      displayName: "Self",
      introduction: "",
      roleId: "general_default",
    });
    const tool = createDelegateToRoleTool({ baseConfig: buildBaseConfig(ws) });
    const result = await tool.execute(
      { role_id: "__missing__", task: "x" },
      buildContext(ws, "self"),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/未知 Role/);
  });

  it("delegate_to_role rejects when no candidates exist", async () => {
    const ws = path.join(tmp, "workspace");
    fs.mkdirSync(ws, { recursive: true });
    upsertAssistant(tmp, {
      assistantId: "self",
      displayName: "Self",
      introduction: "",
      roleId: "general_default",
    });
    const tool = createDelegateToRoleTool({ baseConfig: buildBaseConfig(ws) });
    const result = await tool.execute(
      { role_id: "contract_review", task: "x" },
      buildContext(ws, "self"),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/没有承担/);
  });

  it("delegate_task schema has no parent-gate bypass flag", () => {
    const tool = createDelegateTaskTool({ baseConfig: buildBaseConfig(tmp) });
    const keys = Object.keys(tool.definition.parameters);
    expect(keys).toEqual(expect.arrayContaining(["target_assistant", "task"]));
    expect(keys).not.toContain("bypass");
    expect(keys).not.toContain("permission_mode");
    expect(keys).not.toContain("unrestricted");
    expect(keys).not.toContain("skip_parent_gates");
  });
});
