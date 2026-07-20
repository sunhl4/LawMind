/**
 * Governance metadata must cover every tool in the legal registry
 * (including collaboration + web) without throwing.
 */

import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../../types.js";
import { buildToolGovernanceMetadata, listToolGovernanceMetadata } from "./governance.js";
import { createLegalToolRegistry } from "./legal-tools.js";

const baseConfig: AgentConfig = {
  workspaceDir: "/tmp/lawmind-governance-drift",
  model: {
    provider: "openai-compatible",
    baseUrl: "https://example.invalid/v1",
    apiKey: "test",
    model: "test-model",
  },
  enableCollaboration: true,
  allowWebSearch: true,
  assistantId: "assistant-test",
};

describe("tool governance drift", () => {
  it("buildToolGovernanceMetadata works for every registered tool", () => {
    const registry = createLegalToolRegistry({
      allowWebSearch: true,
      enableCollaboration: true,
      baseConfig,
    });

    const tools = registry.listTools();
    expect(tools.length).toBeGreaterThan(10);

    for (const tool of tools) {
      expect(() => buildToolGovernanceMetadata(tool)).not.toThrow();
      const meta = buildToolGovernanceMetadata(tool);
      expect(meta.name).toBe(tool.definition.name);
      expect(meta.auditEventKind).toBe("tool_call");
    }

    const listed = listToolGovernanceMetadata(registry);
    const listedNames = listed.map((m) => m.name).toSorted();
    const registryNames = tools.map((t) => t.definition.name).toSorted();
    expect(listedNames).toEqual(registryNames);

    const openAiNames = registry
      .toOpenAITools()
      .map((t) => t.function.name)
      .toSorted();
    expect(openAiNames).toEqual(registryNames);
  });
});
