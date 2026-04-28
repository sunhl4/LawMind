import { describe, expect, it } from "vitest";
import { toolRequiresExplicitApproval } from "./dangerous-tool-policy.js";
import type { ToolDefinition } from "./types.js";

const defApproved: ToolDefinition = {
  name: "write_document",
  description: "w",
  category: "draft",
  parameters: {},
  requiresApproval: true,
};

describe("dangerous-tool-policy", () => {
  it("non-strict: requiresApproval respects allowDangerous bypass", () => {
    expect(
      toolRequiresExplicitApproval({
        toolName: "write_document",
        definition: defApproved,
        allowDangerousToolsWithoutApproval: false,
        strictDangerousToolApproval: false,
      }),
    ).toBe(true);
    expect(
      toolRequiresExplicitApproval({
        toolName: "write_document",
        definition: defApproved,
        allowDangerousToolsWithoutApproval: true,
        strictDangerousToolApproval: false,
      }),
    ).toBe(false);
  });

  it("strict: requiresApproval always needs explicit approval even when allowDangerous is true", () => {
    expect(
      toolRequiresExplicitApproval({
        toolName: "write_document",
        definition: defApproved,
        allowDangerousToolsWithoutApproval: true,
        strictDangerousToolApproval: true,
      }),
    ).toBe(true);
  });

  it("strict: execute_workflow needs explicit approval without requiresApproval on definition", () => {
    const defExec: ToolDefinition = {
      name: "execute_workflow",
      description: "x",
      category: "draft",
      parameters: { instruction: { type: "string", description: "i", required: true } },
    };
    expect(
      toolRequiresExplicitApproval({
        toolName: "execute_workflow",
        definition: defExec,
        allowDangerousToolsWithoutApproval: true,
        strictDangerousToolApproval: true,
      }),
    ).toBe(true);
    expect(
      toolRequiresExplicitApproval({
        toolName: "execute_workflow",
        definition: defExec,
        allowDangerousToolsWithoutApproval: true,
        strictDangerousToolApproval: false,
      }),
    ).toBe(false);
  });
});
