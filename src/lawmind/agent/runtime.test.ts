import { describe, expect, it } from "vitest";
import { validateToolArguments } from "./runtime.js";
import type { ToolDefinition } from "./types.js";

const def: ToolDefinition = {
  name: "demo_tool",
  description: "demo",
  category: "system",
  parameters: {
    query: { type: "string", description: "query", required: true },
    limit: { type: "number", description: "limit" },
    mode: { type: "string", description: "mode", enum: ["fast", "full"] },
  },
};

describe("validateToolArguments", () => {
  it("accepts valid arguments", () => {
    const error = validateToolArguments(def, { query: "abc", limit: 3, mode: "fast" });
    expect(error).toBeUndefined();
  });

  it("rejects unknown keys", () => {
    const error = validateToolArguments(def, { query: "abc", unknown: 1 });
    expect(error).toContain("unknown keys");
  });

  it("rejects missing required key", () => {
    const error = validateToolArguments(def, { mode: "fast" });
    expect(error).toContain("missing required key");
  });

  it("rejects wrong type", () => {
    const error = validateToolArguments(def, { query: "abc", limit: "3" });
    expect(error).toContain('key "limit" expects number');
  });

  it("rejects enum mismatch", () => {
    const error = validateToolArguments(def, { query: "abc", mode: "invalid" });
    expect(error).toContain('key "mode" must be one of');
  });
});
