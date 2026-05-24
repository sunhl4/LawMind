import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../agent/tools/registry.js";
import type { AgentTool } from "../agent/types.js";
import { partitionToolCalls } from "./tool-concurrency.js";

function stubTool(name: string, isConcurrencySafe?: boolean): AgentTool {
  return {
    definition: {
      name,
      description: name,
      category: "search",
      parameters: {},
      isConcurrencySafe,
    },
    execute: async () => ({ ok: true }),
  };
}

describe("partitionToolCalls", () => {
  it("groups consecutive safe tools", () => {
    const registry = new ToolRegistry();
    registry.register(stubTool("search_workspace", true));
    registry.register(stubTool("read_project_file", true));
    registry.register(stubTool("draft_document", false));

    const batches = partitionToolCalls(
      [
        { id: "1", name: "search_workspace", arguments: {} },
        { id: "2", name: "read_project_file", arguments: {} },
        { id: "3", name: "draft_document", arguments: {} },
      ],
      registry,
    );
    expect(batches).toHaveLength(2);
    expect(batches[0]?.concurrencySafe).toBe(true);
    expect(batches[0]?.calls).toHaveLength(2);
    expect(batches[1]?.concurrencySafe).toBe(false);
  });
});
