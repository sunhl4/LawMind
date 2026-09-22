/**
 * Engine researching — smoke test for researchTask with a stub adapter.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAllAuditLogs } from "../audit/index.js";
import type { RetrievalAdapter } from "../retrieval/index.js";
import { readTaskRecord } from "../tasks/index.js";
import type { TaskIntent } from "../types.js";
import { buildEngineContext } from "./context.js";
import { researchTask } from "./researching.js";

function stubAdapter(): RetrievalAdapter {
  return {
    name: "stub-research",
    supports: () => true,
    retrieve: async () => ({
      sources: [{ id: "src-1", title: "测试来源", kind: "memo" }],
      claims: [
        {
          text: "测试结论",
          sourceIds: ["src-1"],
          confidence: 0.8,
          model: "stub",
        },
      ],
      riskFlags: [],
      missingItems: [],
    }),
  };
}

function minimalIntent(overrides: Partial<TaskIntent> = {}): TaskIntent {
  return {
    taskId: "task-research-1",
    kind: "analyze.contract",
    output: "docx",
    instruction: "请检索合同风险要点",
    summary: "合同风险检索",
    riskLevel: "medium",
    models: ["legal"],
    requiresConfirmation: false,
    createdAt: new Date().toISOString(),
    matterId: "matter-research-1",
    ...overrides,
  };
}

describe("engine/researching", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-researching-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("researchTask merges adapter results and marks task researched", async () => {
    const intent = minimalIntent();
    const ctx = buildEngineContext({
      workspaceDir,
      adapters: [stubAdapter()],
    });

    const bundle = await researchTask(ctx, intent);

    expect(bundle.sources).toHaveLength(1);
    expect(bundle.claims[0]?.text).toBe("测试结论");
    expect(readTaskRecord(workspaceDir, intent.taskId)?.status).toBe("researched");

    const events = await readAllAuditLogs(path.join(workspaceDir, "audit"));
    expect(events.some((e) => e.kind === "research.started" && e.taskId === intent.taskId)).toBe(
      true,
    );
    expect(events.some((e) => e.kind === "research.completed" && e.taskId === intent.taskId)).toBe(
      true,
    );
  });

  it("rejects research when confirmation is still required", async () => {
    const intent = minimalIntent({
      taskId: "task-research-confirm",
      requiresConfirmation: true,
    });
    const ctx = buildEngineContext({
      workspaceDir,
      adapters: [stubAdapter()],
    });

    await expect(researchTask(ctx, intent)).rejects.toThrow(/需要先确认/);
  });
});
