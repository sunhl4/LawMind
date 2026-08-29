import { describe, expect, it } from "vitest";
import { stripUnknownToolArguments, validateToolArguments } from "./runtime-tool-validation.js";
import type { ToolDefinition } from "./types.js";

const def: ToolDefinition = {
  name: "demo_tool",
  description: "demo",
  category: "system",
  parameters: {
    query: { type: "string", description: "query", required: true },
    limit: { type: "number", description: "limit" },
  },
};

describe("stripUnknownToolArguments", () => {
  it("removes unknown keys and keeps schema keys + __approved", () => {
    const args: Record<string, unknown> = {
      query: "x",
      extra: true,
      __approved: true,
    };
    const stripped = stripUnknownToolArguments(def, args);
    expect(stripped).toEqual(["extra"]);
    expect(args).toEqual({ query: "x", __approved: true });
    expect(validateToolArguments(def, args)).toBeUndefined();
  });
});
