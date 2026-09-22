import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPendingMemorySuggestions } from "../memory/adoption-service.js";
import {
  normalizeAdoptionPayload,
  splitLearningBullets,
  suggestLearningFromDraftReview,
} from "./review-learning-suggest.js";

describe("review-learning-suggest", () => {
  let workspaceDir: string;
  let auditDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-review-learn-"));
    auditDir = path.join(workspaceDir, "audit");
    await fs.mkdir(auditDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("splitLearningBullets splits Chinese clauses", () => {
    expect(splitLearningBullets("语气更克制。管辖条款必须单列。")).toEqual([
      "语气更克制。",
      "管辖条款必须单列。",
    ]);
  });

  it("normalizeAdoptionPayload collapses whitespace", () => {
    expect(normalizeAdoptionPayload("  A\n B  ")).toBe("a b");
  });

  it("creates pending assistant + lawyer suggestions from modified note", async () => {
    const created = await suggestLearningFromDraftReview({
      workspaceDir,
      auditDir,
      taskId: "task-m1",
      status: "modified",
      note: "争议解决须单列仲裁地",
      assistantId: "asst_contract",
    });
    expect(created.length).toBeGreaterThanOrEqual(1);
    const pending = await listPendingMemorySuggestions(workspaceDir);
    expect(pending.some((r) => r.kind === "assistant.profile_section")).toBe(true);
    expect(pending.some((r) => r.kind === "lawyer.profile_learning")).toBe(true);
    expect(pending.every((r) => r.state === "pending")).toBe(true);
  });

  it("skips empty notes and non-modified status", async () => {
    expect(
      await suggestLearningFromDraftReview({
        workspaceDir,
        auditDir,
        taskId: "t1",
        status: "modified",
        note: "  ",
        assistantId: "a1",
      }),
    ).toEqual([]);
    expect(
      await suggestLearningFromDraftReview({
        workspaceDir,
        auditDir,
        taskId: "t1",
        status: "approved",
        note: "ok",
        assistantId: "a1",
      }),
    ).toEqual([]);
  });

  it("dedupes same payload within 7 days", async () => {
    const params = {
      workspaceDir,
      auditDir,
      taskId: "task-dup",
      status: "modified" as const,
      note: "引用必须锚定条文",
      assistantId: "a1",
    };
    const first = await suggestLearningFromDraftReview(params);
    expect(first.length).toBeGreaterThan(0);
    const second = await suggestLearningFromDraftReview({
      ...params,
      taskId: "task-dup-2",
    });
    expect(second).toEqual([]);
  });

  it("skips when labels already own the write path", async () => {
    const created = await suggestLearningFromDraftReview({
      workspaceDir,
      auditDir,
      taskId: "task-labeled",
      status: "modified",
      note: "应补充违约金上限",
      assistantId: "a1",
      skipBecauseLabels: true,
    });
    expect(created).toEqual([]);
  });
});
