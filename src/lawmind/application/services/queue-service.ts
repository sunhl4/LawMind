/**
 * Work Queue / Approval read service — W3/W4。
 *
 * 读取顺序：
 *   1. JSON 真相源（workspace/matters/<id>/queue.jsonl / approvals.jsonl），若有则优先返回。
 *   2. 任务/草稿（及案件档案小节）派生（向后兼容；无 JSON 真相源的旧工作区仍可用）。
 *
 * 列表路径不走 `buildMatterIndex`：派生函数只用 tasks / drafts / 档案小节，
 * 不读 audit；全量 index 每案扫近 8k 条 audit，会把在办卡到数秒。
 * 快照只在「同一次并发加载」间共用，写审批/队列后必须 `invalidateQueueListSnap`。
 */

import fs from "node:fs/promises";
import {
  listMatterIdsFromStorage,
  readApprovals,
  readQueueItems,
} from "../../adapters/matter-storage/index.js";
import { listMatterIds } from "../../cases/index.js";
import {
  buildApprovalRequestsFromMatterIndex,
  buildQueueItemsFromMatterIndex,
  type ApprovalRequest,
  type WorkQueueItem,
} from "../../core/contracts.js";
import { listDrafts } from "../../drafts/index.js";
import { caseFilePath } from "../../memory/index.js";
import { listTaskRecords } from "../../tasks/index.js";
import type { ArtifactDraft, MatterIndex, TaskRecord } from "../../types.js";

type MatterSections = {
  coreIssues: string[];
  taskGoals: string[];
  riskNotes: string[];
  latestUpdatedAt?: string;
};

type QueueWorkspaceSnap = {
  matterIds: string[];
  tasksByMatter: Map<string, TaskRecord[]>;
  draftsByMatter: Map<string, ArtifactDraft[]>;
  sectionsByMatter: Map<string, MatterSections>;
};

/** 仅合并进行中的并发读；完成后立即丢弃，避免写后读到旧列表。 */
const inflightSnaps = new Map<string, Promise<QueueWorkspaceSnap>>();

/** 审批/队列写路径在落盘后调用，保证下一读不会撞上未完成的旧快照。 */
export function invalidateQueueListSnap(workspaceDir?: string): void {
  if (!workspaceDir) {
    inflightSnaps.clear();
    return;
  }
  const prefix = `${workspaceDir}\0`;
  for (const key of inflightSnaps.keys()) {
    if (key === workspaceDir || key.startsWith(prefix)) {
      inflightSnaps.delete(key);
    }
  }
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractSectionEntries(content: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\n\\n([\\s\\S]*?)(?:\\n##\\s+\\d+\\.|$)`);
  const match = pattern.exec(content);
  if (!match) {
    return [];
  }

  return uniq(
    match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*(\[[^\]]+\]\s*)?/, "").trim()),
  );
}

async function unifiedMatterIds(workspaceDir: string): Promise<string[]> {
  const fromStorage = listMatterIdsFromStorage(workspaceDir);
  const fromIndex = await listMatterIds(workspaceDir);
  return Array.from(new Set([...fromStorage, ...fromIndex]));
}

function groupByMatterId<T extends { matterId?: string | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = row.matterId?.trim();
    if (!id) {
      continue;
    }
    const bucket = map.get(id);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(id, [row]);
    }
  }
  return map;
}

async function loadQueueWorkspaceSnap(
  workspaceDir: string,
  matterIdFilter?: string,
): Promise<QueueWorkspaceSnap> {
  const cacheKey = `${workspaceDir}\0${matterIdFilter ?? "*"}`;
  const hit = inflightSnaps.get(cacheKey);
  if (hit) {
    return hit;
  }

  const promise = (async (): Promise<QueueWorkspaceSnap> => {
    const matterIds = matterIdFilter ? [matterIdFilter] : await unifiedMatterIds(workspaceDir);
    const tasksByMatter = groupByMatterId(listTaskRecords(workspaceDir));
    const draftsByMatter = groupByMatterId(listDrafts(workspaceDir));
    const sectionsByMatter = new Map<string, MatterSections>();

    await Promise.all(
      matterIds.map(async (matterId) => {
        const content = await fs
          .readFile(caseFilePath(workspaceDir, matterId), "utf8")
          .catch(() => "");
        const tasks = tasksByMatter.get(matterId) ?? [];
        sectionsByMatter.set(matterId, {
          coreIssues: extractSectionEntries(content, "## 4. 核心争点"),
          taskGoals: extractSectionEntries(content, "## 6. 当前任务目标"),
          riskNotes: extractSectionEntries(content, "## 7. 风险与待确认事项"),
          latestUpdatedAt: tasks
            .map((task) => task.updatedAt)
            .filter(Boolean)
            .toSorted()
            .at(-1),
        });
      }),
    );

    return { matterIds, tasksByMatter, draftsByMatter, sectionsByMatter };
  })();

  inflightSnaps.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    if (inflightSnaps.get(cacheKey) === promise) {
      inflightSnaps.delete(cacheKey);
    }
  }
}

/** 派生用的轻量 MatterIndex：不含 audit / 全文 caseMemory。 */
function deriveIndexForMatter(snap: QueueWorkspaceSnap, matterId: string): MatterIndex {
  const sections = snap.sectionsByMatter.get(matterId) ?? {
    coreIssues: [],
    taskGoals: [],
    riskNotes: [],
  };
  const tasks = snap.tasksByMatter.get(matterId) ?? [];
  const drafts = snap.draftsByMatter.get(matterId) ?? [];
  return {
    matterId,
    caseFilePath: "",
    caseMemory: "",
    coreIssues: sections.coreIssues,
    taskGoals: sections.taskGoals,
    riskNotes: sections.riskNotes,
    progressEntries: [],
    artifacts: [],
    tasks,
    drafts,
    auditEvents: [],
    openTasks: tasks.filter((task) => task.status !== "rendered" && task.status !== "rejected"),
    renderedTasks: tasks.filter((task) => task.status === "rendered"),
    latestUpdatedAt: sections.latestUpdatedAt,
  };
}

async function approvalsForMatter(
  workspaceDir: string,
  matterId: string,
  snap: QueueWorkspaceSnap,
): Promise<ApprovalRequest[]> {
  const stored = readApprovals(workspaceDir, matterId) as ApprovalRequest[];
  const derived = buildApprovalRequestsFromMatterIndex(deriveIndexForMatter(snap, matterId));
  return mergeUniqueById(stored, derived, (a) => a.approvalId);
}

async function queueForMatter(
  workspaceDir: string,
  matterId: string,
  snap: QueueWorkspaceSnap,
): Promise<WorkQueueItem[]> {
  const stored = readQueueItems(workspaceDir, matterId) as WorkQueueItem[];
  const derived = buildQueueItemsFromMatterIndex(deriveIndexForMatter(snap, matterId));
  return mergeUniqueById(stored, derived, (q) => q.queueItemId);
}

/** 真相源优先：JSON 写侧 service 写入的条目永远覆盖派生条目；剩余派生条目按 id 补齐。 */
function mergeUniqueById<T>(primary: T[], secondary: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of primary) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  for (const item of secondary) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export async function listApprovalRequests(
  workspaceDir: string,
  opts?: { matterId?: string; status?: ApprovalRequest["status"]; targetRole?: string },
): Promise<ApprovalRequest[]> {
  const snap = await loadQueueWorkspaceSnap(workspaceDir, opts?.matterId);
  const all = (
    await Promise.all(snap.matterIds.map((id) => approvalsForMatter(workspaceDir, id, snap)))
  ).flat();
  return all
    .filter((item) => (opts?.status ? item.status === opts.status : true))
    .filter((item) => (opts?.targetRole ? item.targetRole === opts.targetRole : true))
    .toSorted((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function listWorkQueueItems(
  workspaceDir: string,
  opts?: {
    matterId?: string;
    kind?: WorkQueueItem["kind"];
    status?: WorkQueueItem["status"];
  },
): Promise<WorkQueueItem[]> {
  const snap = await loadQueueWorkspaceSnap(workspaceDir, opts?.matterId);
  const all = (
    await Promise.all(snap.matterIds.map((id) => queueForMatter(workspaceDir, id, snap)))
  ).flat();
  return all
    .filter((item) => (opts?.kind ? item.kind === opts.kind : true))
    .filter((item) => (opts?.status ? item.status === opts.status : true))
    .toSorted((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (byPriority !== 0) {
        return byPriority;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}
