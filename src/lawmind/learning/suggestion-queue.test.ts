import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistDraft } from "../drafts/index.js";
import type { ArtifactDraft } from "../types.js";
import {
  adoptLearningSuggestion,
  dismissLearningSuggestion,
  enqueueLearningSuggestion,
  listLearningSuggestions,
} from "./suggestion-queue.js";

describe("learning suggestion queue", () => {
  let tmp: string;
  const auditDir = () => path.join(tmp!, "audit");

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("enqueues and adopts with memory writes", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lm-lq-"));
    await fs.mkdir(auditDir(), { recursive: true });

    const draft: ArtifactDraft = {
      taskId: "task-learn-1",
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
    persistDraft(tmp, draft);

    const rec = await enqueueLearningSuggestion(tmp, auditDir(), {
      taskId: draft.taskId,
      reviewStatus: "approved",
      labels: ["tone.too_weak"],
      assistantId: undefined,
    });

    const pending = await listLearningSuggestions(tmp, "pending");
    expect(pending.some((p) => p.id === rec.id)).toBe(true);

    const adopt = await adoptLearningSuggestion(tmp, auditDir(), rec.id);
    expect(adopt.ok).toBe(true);

    const after = await listLearningSuggestions(tmp, "pending");
    expect(after.some((p) => p.id === rec.id)).toBe(false);
  });

  it("dismisses pending suggestion", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lm-lq2-"));
    await fs.mkdir(auditDir(), { recursive: true });

    const rec = await enqueueLearningSuggestion(tmp, auditDir(), {
      taskId: "nope",
      reviewStatus: "modified",
      labels: ["issue.missing"],
    });

    const d = await dismissLearningSuggestion(tmp, auditDir(), rec.id);
    expect(d.ok).toBe(true);
    const pending = await listLearningSuggestions(tmp, "pending");
    expect(pending.some((p) => p.id === rec.id)).toBe(false);
  });
});
