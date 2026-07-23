/**
 * Engine reviewing — unit tests for reviewDraft side effects.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readAllAuditLogs } from "../audit/index.js";
import { persistDraft } from "../drafts/index.js";
import { loadAgentSpecializationStore } from "../learning/agent-specialization.js";
import { listPendingMemorySuggestions } from "../memory/adoption-service.js";
import { summarizeProductMetrics } from "../metrics/product-metrics.js";
import type { ArtifactDraft } from "../types.js";
import { buildEngineContext } from "./context.js";
import { reviewDraft } from "./reviewing.js";

describe("engine/reviewing", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-reviewing-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "cases", "matter-r"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "cases", "matter-r", "CASE.md"), "# Case\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("reviewDraft sets approved status and emits draft.reviewed audit", async () => {
    const taskId = "task-review-1";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Review test",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);

    const ctx = buildEngineContext({
      workspaceDir,
      adapters: [],
    });
    const reviewed = await reviewDraft(ctx, draft, {
      actorId: "lawyer:test",
      status: "approved",
      note: "LGTM",
    });

    expect(reviewed.reviewStatus).toBe("approved");
    expect(reviewed.reviewedBy).toBe("lawyer:test");
    const events = await readAllAuditLogs(path.join(workspaceDir, "audit"));
    expect(events.some((e) => e.kind === "draft.reviewed" && e.taskId === taskId)).toBe(true);
  });

  it("records specialization + product metrics on first-pass approve", async () => {
    const taskId = "task-review-metrics";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Metrics",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [], assistantId: "asst_a" });
    await reviewDraft(ctx, draft, { status: "approved", assistantId: "asst_a" });
    const store = loadAgentSpecializationStore(workspaceDir);
    expect(store.byAssistant.asst_a?.firstPassApprovals).toBe(1);
    const metrics = summarizeProductMetrics(workspaceDir);
    expect(metrics.firstPassOk).toBe(1);
    expect(metrics.rewrites).toBe(0);
  });

  it("modified with note creates pending adoptions and rewrite metric", async () => {
    const taskId = "task-review-modified";
    const draft: ArtifactDraft = {
      taskId,
      matterId: "matter-r",
      title: "Mod",
      summary: "summary",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    persistDraft(workspaceDir, draft);
    const ctx = buildEngineContext({ workspaceDir, adapters: [], assistantId: "asst_b" });
    await reviewDraft(ctx, draft, {
      status: "modified",
      note: "管辖条款必须单列",
      assistantId: "asst_b",
    });
    const metrics = summarizeProductMetrics(workspaceDir);
    expect(metrics.rewrites).toBe(1);
    const pending = await listPendingMemorySuggestions(workspaceDir);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.some((r) => r.sourceTaskId === taskId)).toBe(true);
  });
});
