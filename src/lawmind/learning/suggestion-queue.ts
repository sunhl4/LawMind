/**
 * 审核学习建议队列：先入队，律师在桌面或 CLI adopt 后再写回 PROFILE / Playbook。
 *
 * 写侧兼容：W5 起 enqueue 会镜像到 `memory/adoption-service`。
 * 读侧真相源：请用 `listPendingAdoptionsUnified` / Inspector 的 `/api/memory/adoption`；
 * 本模块的 list/adopt 仅保留给文书台 deferred 标签队列兼容路径。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { emit } from "../audit/index.js";
import { readDraft } from "../drafts/index.js";
import type { ReviewLabel, ReviewStatus } from "../types.js";
import { applyReviewLabelsMemoryWrites } from "./apply-review-labels.js";

const FILE_VERSION = 1;

export type LearningSuggestionState = "pending" | "adopted" | "dismissed";

export type LearningSuggestionRecord = {
  id: string;
  createdAt: string;
  state: LearningSuggestionState;
  taskId: string;
  matterId?: string;
  /** 审核时选择的 status */
  reviewStatus: Exclude<ReviewStatus, "pending">;
  note?: string;
  labels: ReviewLabel[];
  assistantId?: string;
  adoptedAt?: string;
};

type QueueFile = {
  schemaVersion: number;
  items: LearningSuggestionRecord[];
};

function queuePath(workspaceDir: string): string {
  return path.join(workspaceDir, "learning", "suggestions.json");
}

async function readQueue(workspaceDir: string): Promise<QueueFile> {
  try {
    const raw = await fs.readFile(queuePath(workspaceDir), "utf8");
    const parsed = JSON.parse(raw) as QueueFile;
    if (!parsed.items || !Array.isArray(parsed.items)) {
      return { schemaVersion: FILE_VERSION, items: [] };
    }
    return parsed;
  } catch {
    return { schemaVersion: FILE_VERSION, items: [] };
  }
}

async function writeQueue(workspaceDir: string, data: QueueFile): Promise<void> {
  const p = queuePath(workspaceDir);
  await fs.mkdir(path.dirname(p), { recursive: true });
  // 原子写：temp + rename，避免并发 adopt/dismiss/enqueue 互相覆盖或崩溃撕档。
  const { writeFileAtomicAsync } = await import("../adapters/matter-storage/io.js");
  await writeFileAtomicAsync(p, JSON.stringify(data, null, 2));
}

export async function listLearningSuggestions(
  workspaceDir: string,
  filter: "pending" | "all" = "pending",
): Promise<LearningSuggestionRecord[]> {
  const data = await readQueue(workspaceDir);
  const items = data.items ?? [];
  if (filter === "all") {
    return items.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return items
    .filter((i) => i.state === "pending")
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function enqueueLearningSuggestion(
  workspaceDir: string,
  auditDir: string,
  input: Omit<LearningSuggestionRecord, "id" | "createdAt" | "state" | "adoptedAt">,
): Promise<LearningSuggestionRecord> {
  const data = await readQueue(workspaceDir);
  const rec: LearningSuggestionRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    state: "pending",
    ...input,
  };
  data.schemaVersion = FILE_VERSION;
  data.items.push(rec);
  await writeQueue(workspaceDir, data);
  await emit(auditDir, {
    taskId: input.taskId,
    kind: "learning.suggestion_queued",
    actor: "lawyer",
    detail: JSON.stringify({ suggestionId: rec.id, labels: input.labels }),
  });
  // W5：镜像写入 MemoryAdoptionService，让 Inspector 在统一界面看到 review-label 待采纳。
  try {
    const { suggestMemoryAdoption } = await import("../memory/adoption-service.js");
    await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "lawyer",
      kind: "review_label",
      payload: JSON.stringify({ labels: input.labels, note: input.note ?? null }),
      targetId: input.matterId,
      sourceTaskId: input.taskId,
      origin: "lawyer",
      note: input.note,
    });
  } catch {
    // best-effort
  }
  return rec;
}

export async function adoptLearningSuggestion(
  workspaceDir: string,
  auditDir: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const data = await readQueue(workspaceDir);
  const idx = data.items.findIndex((i) => i.id === id);
  if (idx < 0) {
    return { ok: false, error: "not_found" };
  }
  const rec = data.items[idx];
  if (rec.state !== "pending") {
    return { ok: false, error: "not_pending" };
  }
  const draft = readDraft(workspaceDir, rec.taskId);
  if (!draft) {
    return { ok: false, error: "draft_not_found" };
  }

  await applyReviewLabelsMemoryWrites(workspaceDir, auditDir, draft, {
    status: rec.reviewStatus,
    note: rec.note,
    labels: rec.labels,
    assistantId: rec.assistantId,
  });

  rec.state = "adopted";
  rec.adoptedAt = new Date().toISOString();
  data.items[idx] = rec;
  await writeQueue(workspaceDir, data);

  await emit(auditDir, {
    taskId: rec.taskId,
    kind: "learning.suggestion_adopted",
    actor: "lawyer",
    detail: JSON.stringify({ suggestionId: id }),
  });

  // Keep mirrored MemoryAdoptionService review_label rows in sync.
  try {
    const { markAdoptedBySourceTaskId } = await import("../memory/adoption-service.js");
    await markAdoptedBySourceTaskId(workspaceDir, auditDir, rec.taskId, {
      kind: "review_label",
    });
  } catch {
    // best-effort
  }

  return { ok: true };
}

export async function dismissLearningSuggestion(
  workspaceDir: string,
  auditDir: string,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const data = await readQueue(workspaceDir);
  const idx = data.items.findIndex((i) => i.id === id);
  if (idx < 0) {
    return { ok: false, error: "not_found" };
  }
  const rec = data.items[idx];
  if (rec.state !== "pending") {
    return { ok: false, error: "not_pending" };
  }
  rec.state = "dismissed";
  rec.adoptedAt = new Date().toISOString();
  data.items[idx] = rec;
  await writeQueue(workspaceDir, data);
  await emit(auditDir, {
    taskId: rec.taskId,
    kind: "learning.suggestion_dismissed",
    actor: "lawyer",
    detail: JSON.stringify({ suggestionId: id }),
  });
  try {
    const { markDismissedBySourceTaskId } = await import("../memory/adoption-service.js");
    await markDismissedBySourceTaskId(workspaceDir, auditDir, rec.taskId, {
      kind: "review_label",
    });
  } catch {
    // best-effort
  }
  return { ok: true };
}
