import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "./tools/registry.js";
import { prepareTurnPromptContext } from "./turn-orchestrator-prompt.js";
import type { AgentConfig, AgentSession } from "./types.js";

describe("turn-orchestrator-prompt", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-turn-prompt-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Global memory", "utf8");
    await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer profile", "utf8");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("exports prepareTurnPromptContext and seeds system message head", async () => {
    expect(typeof prepareTurnPromptContext).toBe("function");

    const session: AgentSession = {
      sessionId: "sess-1",
      actorId: "system",
      turns: [],
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const registry = new ToolRegistry();
    const config: AgentConfig = {
      workspaceDir,
      model: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
    };

    const result = await prepareTurnPromptContext({
      config,
      registry,
      session,
      instruction: "请审查合同违约责任条款",
      resolvedAssistantId: undefined,
      linkedTaskIdForCtx: undefined,
      projectDirResolved: undefined,
    });

    expect(result.memory.profile).toContain("Lawyer profile");
    expect(result.systemPromptFinal.length).toBeGreaterThan(0);
    expect(session.conversationHistory).toHaveLength(1);
    expect(session.conversationHistory[0]?.role).toBe("system");
    expect(session.conversationHistory[0]?.content).toBe(result.systemPromptFinal);
  });
});
