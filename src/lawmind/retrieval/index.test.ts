/**
 * Retrieval layer — workspace adapter behavior (memory-aware).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemoryContext } from "../memory/index.js";
import type { TaskIntent } from "../types.js";
import { createWorkspaceAdapter } from "./index.js";

function baseIntent(over: Partial<TaskIntent> = {}): TaskIntent {
  const now = new Date().toISOString();
  return {
    taskId: "t-ws-1",
    kind: "research.general",
    output: "markdown",
    instruction: "test",
    summary: "test summary",
    riskLevel: "low",
    models: ["general"],
    requiresConfirmation: false,
    createdAt: now,
    ...over,
  };
}

function memoryShell(over: Partial<MemoryContext>): MemoryContext {
  return {
    general: "",
    profile: "",
    firmProfile: "",
    caseMemory: "",
    matterStrategy: "",
    todayLog: "",
    yesterdayLog: "",
    clausePlaybook: "",
    courtAndOpponentProfile: "",
    clientProfile: "",
    ...over,
  };
}

describe("createWorkspaceAdapter", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-ret-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("adds a workspace source for client profile when memory.clientProfile is non-empty", async () => {
    const clients = path.join(workspaceDir, "clients", "c9");
    await fs.mkdir(clients, { recursive: true });
    await fs.writeFile(path.join(clients, "CLIENT_PROFILE.md"), "c9 profile", "utf8");

    const adapter = createWorkspaceAdapter(workspaceDir);
    const r = await adapter.retrieve({
      intent: baseIntent(),
      memory: memoryShell({
        clientProfile: "c9 profile",
        clientProfileClientId: "c9",
      }),
    });

    const cp = r.sources.find((s) => s.title.startsWith("客户画像："));
    expect(cp).toBeDefined();
    expect(cp?.kind).toBe("workspace");
    expect(cp?.url).toBe(path.join(workspaceDir, "clients", "c9", "CLIENT_PROFILE.md"));
  });

  it("uses root CLIENT_PROFILE path when no clientProfileClientId", async () => {
    await fs.writeFile(path.join(workspaceDir, "CLIENT_PROFILE.md"), "root", "utf8");
    const adapter = createWorkspaceAdapter(workspaceDir);
    const r = await adapter.retrieve({
      intent: baseIntent(),
      memory: memoryShell({ clientProfile: "root" }),
    });
    const cp = r.sources.find((s) => s.title.includes("工作区根目录"));
    expect(cp?.url).toBe(path.join(workspaceDir, "CLIENT_PROFILE.md"));
  });
});
