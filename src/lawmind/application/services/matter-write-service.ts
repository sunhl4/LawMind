/**
 * Matter Write Service — W3。
 *
 * 把 `Matter` 当成一等业务对象（不再只是从 MatterIndex 派生）。
 * 真相源：`workspace/matters/<matterId>/matter.json`。
 * 写入时用 zod schema 校验，错误会作为 `deliverable.spec.invalid` 类似事件
 * 写入审计日志（best-effort），但不直接抛回调用方除非 fatal。
 */

import path from "node:path";
import { loadMatter, saveMatter, type MatterRecord } from "../../adapters/matter-storage/index.js";
import { matterSchema } from "../../adapters/matter-storage/schemas.js";
import { emit } from "../../audit/index.js";

function auditDir(workspaceDir: string): string {
  return path.join(workspaceDir, "audit");
}

async function emitInvalid(workspaceDir: string, matterId: string, message: string): Promise<void> {
  try {
    await emit(auditDir(workspaceDir), {
      taskId: "system",
      kind: "matter.spec.invalid",
      actor: "system",
      detail: `${matterId}: ${message}`,
    });
  } catch {
    // audit failures must not block business logic
  }
}

function newTimestamp(): string {
  return new Date().toISOString();
}

export type MatterCreateInput = {
  matterId: string;
  title?: string;
  status?: MatterRecord["status"];
  sensitivity?: MatterRecord["sensitivity"];
  ownerLawyerId?: string;
  primaryAssistantRoleId?: string;
  strategyStatus?: MatterRecord["strategyStatus"];
  clientId?: string;
};

/** 创建 matter；若已存在直接返回（幂等）。 */
export function createMatterIfMissing(
  workspaceDir: string,
  input: MatterCreateInput,
): MatterRecord {
  const existing = loadMatter(workspaceDir, input.matterId);
  if (existing) {
    return existing;
  }
  const now = newTimestamp();
  const draft: MatterRecord = {
    matterId: input.matterId,
    clientId: input.clientId,
    title: input.title ?? input.matterId,
    status: input.status ?? "intake",
    sensitivity: input.sensitivity ?? "normal",
    ownerLawyerId: input.ownerLawyerId,
    primaryAssistantRoleId: input.primaryAssistantRoleId,
    strategyStatus: input.strategyStatus ?? "draft",
    openQuestionIds: [],
    nextActions: [],
    deadlineIds: [],
    deliverableIds: [],
    queueItemIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const parsed = matterSchema.safeParse(draft);
  if (!parsed.success) {
    void emitInvalid(workspaceDir, input.matterId, parsed.error.message);
    throw new Error(`Invalid matter draft for ${input.matterId}: ${parsed.error.message}`);
  }
  return saveMatter(workspaceDir, parsed.data);
}

export function updateMatterStatus(
  workspaceDir: string,
  matterId: string,
  status: MatterRecord["status"],
): MatterRecord | undefined {
  const existing = loadMatter(workspaceDir, matterId);
  if (!existing) {
    return undefined;
  }
  return saveMatter(workspaceDir, { ...existing, status, updatedAt: newTimestamp() });
}

export function setMatterStrategy(
  workspaceDir: string,
  matterId: string,
  strategyStatus: MatterRecord["strategyStatus"],
  opts?: { nextActions?: string[]; openQuestionIds?: string[] },
): MatterRecord | undefined {
  const existing = loadMatter(workspaceDir, matterId);
  if (!existing) {
    return undefined;
  }
  return saveMatter(workspaceDir, {
    ...existing,
    strategyStatus,
    nextActions: opts?.nextActions ?? existing.nextActions,
    openQuestionIds: opts?.openQuestionIds ?? existing.openQuestionIds,
    updatedAt: newTimestamp(),
  });
}

export function attachDeliverableId(
  workspaceDir: string,
  matterId: string,
  deliverableId: string,
): MatterRecord | undefined {
  const existing = loadMatter(workspaceDir, matterId);
  if (!existing) {
    return undefined;
  }
  if (existing.deliverableIds.includes(deliverableId)) {
    return existing;
  }
  return saveMatter(workspaceDir, {
    ...existing,
    deliverableIds: [...existing.deliverableIds, deliverableId],
    updatedAt: newTimestamp(),
  });
}

export function attachQueueItemId(
  workspaceDir: string,
  matterId: string,
  queueItemId: string,
): MatterRecord | undefined {
  const existing = loadMatter(workspaceDir, matterId);
  if (!existing) {
    return undefined;
  }
  if (existing.queueItemIds.includes(queueItemId)) {
    return existing;
  }
  return saveMatter(workspaceDir, {
    ...existing,
    queueItemIds: [...existing.queueItemIds, queueItemId],
    updatedAt: newTimestamp(),
  });
}

export function attachDeadlineId(
  workspaceDir: string,
  matterId: string,
  deadlineId: string,
): MatterRecord | undefined {
  const existing = loadMatter(workspaceDir, matterId);
  if (!existing) {
    return undefined;
  }
  if (existing.deadlineIds.includes(deadlineId)) {
    return existing;
  }
  return saveMatter(workspaceDir, {
    ...existing,
    deadlineIds: [...existing.deadlineIds, deadlineId],
    updatedAt: newTimestamp(),
  });
}

export { loadMatter as readMatter };
export type { MatterRecord };
