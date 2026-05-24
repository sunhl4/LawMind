/**
 * Engine rendering — unit tests for strict gate blocking.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { persistDraft } from "../drafts/index.js";
import type { ArtifactDraft } from "../types.js";
import { buildEngineContext } from "./context.js";
import { renderDraft } from "./rendering.js";

describe("engine/rendering", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-rendering-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "artifacts"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("blocks render when draft is not approved", async () => {
    const draft: ArtifactDraft = {
      taskId: "task-render-block",
      matterId: "matter-1",
      title: "Blocked",
      summary: "summary",
      sections: [{ heading: "结论", body: "x", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const result = await renderDraft(ctx, draft, { strictGates: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/未通过审核/);
  });
});
