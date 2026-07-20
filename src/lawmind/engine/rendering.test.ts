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

  it("blocks render when citationGateStrict and draft has missing source ids", async () => {
    const { persistResearchSnapshot } = await import("../drafts/research-snapshot.js");
    const draft: ArtifactDraft = {
      taskId: "task-cite-block",
      matterId: "matter-1",
      title: "Cite blocked",
      summary: "summary",
      sections: [
        {
          heading: "结论",
          body: "本合同违约金过高，建议调整。".repeat(8),
          citations: ["ghost-source"],
        },
      ],
      reviewStatus: "approved",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    persistResearchSnapshot(workspaceDir, {
      taskId: draft.taskId,
      query: "q",
      sources: [{ id: "s1", title: "真实来源", kind: "statute" }],
      claims: [],
      riskFlags: [],
      missingItems: [],
      requiresReview: false,
      completedAt: new Date().toISOString(),
    });
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const result = await renderDraft(ctx, draft, {
      strictGates: false,
      citationGateStrict: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/引用完整性/);
    expect(result.citationIntegrity?.checked).toBe(true);
  });
});
