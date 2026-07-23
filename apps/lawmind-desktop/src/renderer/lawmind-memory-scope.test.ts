import { describe, expect, it } from "vitest";
import { mapMemoryLayerToScope, memoryScopeLabel } from "./lawmind-memory-scope.js";

describe("lawmind-memory-scope", () => {
  it("maps case paths to matter scope", () => {
    expect(
      mapMemoryLayerToScope({
        id: "case_md",
        label: "CASE",
        relativePath: "cases/m-1/CASE.md",
        exists: true,
        charCount: 10,
        inAgentSystemPrompt: false,
      }),
    ).toBe("matter");
  });

  it("labels scopes in Chinese", () => {
    expect(memoryScopeLabel("firm")).toBe("律所惯例");
  });
});
