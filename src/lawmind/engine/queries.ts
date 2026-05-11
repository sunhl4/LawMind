/**
 * Engine — 只读查询：getTaskState / getDraft / getMatterIndex / listMatterOverviews / ...
 *
 * 当前直接代理到 cases/index.ts 与 drafts/index.ts；未来可改为 application services 路径。
 */

import {
  buildMatterIndex,
  listMatterOverviews,
  searchMatterIndex,
  summarizeMatterIndex,
} from "../cases/index.js";
import { readDraft } from "../drafts/index.js";
import { readTaskRecord } from "../tasks/index.js";
import type {
  ArtifactDraft,
  MatterIndex,
  MatterOverview,
  MatterSearchHit,
  MatterSummary,
  TaskRecord,
} from "../types.js";
import type { EngineContext } from "./context.js";

export function getTaskState(ctx: EngineContext, taskId: string): TaskRecord | undefined {
  return readTaskRecord(ctx.workspaceDir, taskId);
}

export function getDraft(ctx: EngineContext, taskId: string): ArtifactDraft | undefined {
  return readDraft(ctx.workspaceDir, taskId);
}

export function getMatterIndex(ctx: EngineContext, matterId: string): Promise<MatterIndex> {
  return buildMatterIndex(ctx.workspaceDir, matterId);
}

export function listEngineMatterOverviews(ctx: EngineContext): Promise<MatterOverview[]> {
  return listMatterOverviews(ctx.workspaceDir);
}

export async function getEngineMatterSummary(
  ctx: EngineContext,
  matterId: string,
): Promise<MatterSummary> {
  const index = await buildMatterIndex(ctx.workspaceDir, matterId);
  return summarizeMatterIndex(index);
}

export async function searchEngineMatter(
  ctx: EngineContext,
  matterId: string,
  query: string,
): Promise<MatterSearchHit[]> {
  const index = await buildMatterIndex(ctx.workspaceDir, matterId);
  return searchMatterIndex(index, query);
}
