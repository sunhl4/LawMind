/**
 * Engine drafting — smoke test for draftSync persistence.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDraft } from "../drafts/index.js";
import type { ResearchBundle, TaskIntent } from "../types.js";
import { buildEngineContext } from "./context.js";
import { draftSync } from "./drafting.js";

function minimalIntent(overrides: Partial<TaskIntent> = {}): TaskIntent {
  return {
    taskId: "task-draft-1",
    kind: "draft.word",
    output: "docx",
    instruction: "请起草一份保密协议",
    summary: "保密协议草稿",
    riskLevel: "medium",
    models: ["general"],
    requiresConfirmation: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function minimalBundle(taskId: string): ResearchBundle {
  return {
    taskId,
    query: "保密协议",
    sources: [],
    claims: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

describe("engine/drafting", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-drafting-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("draftSync builds a pending draft and persists it", () => {
    const intent = minimalIntent();
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const draft = draftSync(ctx, intent, minimalBundle(intent.taskId), {
      title: "测试保密协议",
    });

    expect(draft.reviewStatus).toBe("pending");
    expect(draft.taskId).toBe(intent.taskId);
    expect(draft.title).toBe("测试保密协议");

    const loaded = readDraft(workspaceDir, intent.taskId);
    expect(loaded?.title).toBe("测试保密协议");
    expect(loaded?.reviewStatus).toBe("pending");
  });
});
