/**
 * Engine 工厂 — 装配 plan / research / draft / review / render / queries。
 *
 * 与历史 `src/lawmind/index.ts` 中 `createLawMindEngine` 行为完全一致；
 * 新代码请优先从这里 import：`import { createLawMindEngine } from "./engine/factory.js"`。
 * 旧入口 `src/lawmind/index.ts` 仍然 re-export 本函数以保持向后兼容。
 */

import { applyWorkspaceDeliverableSpecs } from "../deliverables/workspace-loader.js";
import { buildEngineContext } from "./context.js";
import { draftAsyncImpl, draftSync } from "./drafting.js";
import { confirmTask, planAsyncImpl, planSync } from "./planning.js";
import {
  getDraft,
  getEngineMatterSummary,
  getMatterIndex,
  getTaskState,
  listEngineMatterOverviews,
  searchEngineMatter,
} from "./queries.js";
import { renderDraft } from "./rendering.js";
import { researchTask } from "./researching.js";
import { recordQualityImpl, reopenDraftReviewImpl, reviewDraft } from "./reviewing.js";
import { emitWorkspaceSpecWarnings } from "./shared.js";
import type { LawMindEngine, LawMindEngineConfig } from "./types.js";

export function createLawMindEngine(config: LawMindEngineConfig): LawMindEngine {
  const ctx = buildEngineContext(config);

  // Same gate as the deliverable-check CLI (`applyWorkspaceDeliverableSpecs`).
  // Solo default on. Bad JSON → warnings, never abort startup.
  const workspaceSpecs = applyWorkspaceDeliverableSpecs(ctx.workspaceDir);
  if (workspaceSpecs.result.warnings.length > 0) {
    void emitWorkspaceSpecWarnings(ctx.auditDir, workspaceSpecs.result.warnings);
  }

  return {
    plan(instruction, opts = {}) {
      return planSync(ctx, instruction, opts);
    },
    planAsync(instruction, opts = {}) {
      return planAsyncImpl(ctx, instruction, opts);
    },
    confirm(taskId, opts = {}) {
      return confirmTask(ctx, taskId, opts);
    },
    research(intent, opts = {}) {
      return researchTask(ctx, intent, opts);
    },
    draft(intent, bundle, opts = {}) {
      return draftSync(ctx, intent, bundle, opts);
    },
    draftAsync(intent, bundle, opts = {}) {
      return draftAsyncImpl(ctx, intent, bundle, opts);
    },
    async review(draft, opts = {}) {
      const result = await reviewDraft(ctx, draft, opts);
      return result.draft;
    },
    reopenDraftReview(taskId, opts = {}) {
      return reopenDraftReviewImpl(ctx, taskId, opts);
    },
    recordQuality(taskId, opts = {}) {
      return recordQualityImpl(ctx, taskId, opts);
    },
    render(draft, opts) {
      return renderDraft(ctx, draft, opts);
    },
    getTaskState(taskId) {
      return getTaskState(ctx, taskId);
    },
    getDraft(taskId) {
      return getDraft(ctx, taskId);
    },
    getMatterIndex(matterId) {
      return getMatterIndex(ctx, matterId);
    },
    listMatterOverviews() {
      return listEngineMatterOverviews(ctx);
    },
    getMatterSummary(matterId) {
      return getEngineMatterSummary(ctx, matterId);
    },
    searchMatter(matterId, query) {
      return searchEngineMatter(ctx, matterId, query);
    },
  };
}
