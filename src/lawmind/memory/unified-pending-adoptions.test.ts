import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistDraft } from "../drafts/index.js";
import {
  enqueueLearningSuggestion,
  listLearningSuggestions,
} from "../learning/suggestion-queue.js";
import type { ArtifactDraft } from "../types.js";
import { listPendingMemorySuggestions, suggestMemoryAdoption } from "./adoption-service.js";
import { listPendingAdoptionsUnified } from "./unified-pending-adoptions.js";

describe("listPendingAdoptionsUnified", () => {
  let ws: string;
  const audit = () => path.join(ws, "audit");

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("uses adoption as truth and dedupes learning by sourceTaskId", async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-unified-adopt-"));
    await fs.mkdir(audit(), { recursive: true });

    const draft: ArtifactDraft = {
      taskId: "task-u1",
      title: "T",
      output: "docx",
      templateId: "default",
      summary: "s",
      sections: [],
      reviewNotes: [],
      reviewStatus: "approved",
      reviewedBy: "lawyer",
      reviewedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    persistDraft(ws, draft);

    await enqueueLearningSuggestion(ws, audit(), {
      taskId: "task-u1",
      matterId: "m1",
      reviewStatus: "approved",
      labels: ["tone"],
      note: "n",
    });

    const mirrored = await listPendingMemorySuggestions(ws);
    expect(mirrored.some((r) => r.sourceTaskId === "task-u1")).toBe(true);

    const unified = await listPendingAdoptionsUnified(ws);
    const forTask = unified.filter((r) => r.sourceTaskId === "task-u1");
    expect(forTask).toHaveLength(1);
    expect(forTask[0]?.kind).toBe("review_label");
    expect(forTask[0]?.id.startsWith("learning:")).toBe(false);
  });

  it("surfaces unmirrored learning rows once", async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-unified-learn-"));
    await fs.mkdir(audit(), { recursive: true });

    // Write learning queue without going through enqueue (no mirror).
    const queuePath = path.join(ws, "learning", "suggestions.json");
    await fs.mkdir(path.dirname(queuePath), { recursive: true });
    await fs.writeFile(
      queuePath,
      JSON.stringify({
        schemaVersion: 1,
        items: [
          {
            id: "learn-orphan-1",
            createdAt: new Date().toISOString(),
            state: "pending",
            taskId: "task-orphan",
            reviewStatus: "approved",
            labels: ["risk"],
          },
        ],
      }),
      "utf8",
    );

    await suggestMemoryAdoption(ws, audit(), {
      scope: "matter",
      kind: "case.progress",
      payload: "other",
      sourceTaskId: "task-other",
      targetId: "m2",
    });

    const learning = await listLearningSuggestions(ws, "pending");
    expect(learning).toHaveLength(1);

    const unified = await listPendingAdoptionsUnified(ws);
    expect(unified.filter((r) => r.sourceTaskId === "task-orphan")).toHaveLength(1);
    expect(unified.filter((r) => r.sourceTaskId === "task-other")).toHaveLength(1);
    expect(unified.filter((r) => r.sourceTaskId === "task-orphan")[0]?.learningSuggestionId).toBe(
      "learn-orphan-1",
    );
  });
});
