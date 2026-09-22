/**
 * Engine — 步骤 3：draft / draftAsync。
 *
 * W7：若 EngineContext 关联到一个 Role 且 Role.allowedDeliverableTypes 不允许
 * 当前 deliverable kind，则拒绝（throw DraftCreationError）。Solo edition 仅 warn。
 */

import { getAssistantById, resolveLawMindRoot } from "../assistants/store.js";
import { getRoleById, roleAllowsDeliverable } from "../core/role.js";
import { persistClauseSnapshot } from "../drafts/clause-snapshot.js";
import {
  draftLooksLikeContractBody,
  enrichDraftWithContractEditBaseline,
  stampContractEditBaselineIfNeeded,
} from "../drafts/contract-edit-baseline.js";
import { buildDraft, buildDraftAsync, runDraftCriticAsync } from "../reasoning/index.js";
import type { ArtifactDraft, ResearchBundle, TaskIntent } from "../types.js";
import type { EngineContext } from "./context.js";
import { classifyDeliverableKindFromIntent } from "./role-helpers.js";
import { persistDraftPipeline } from "./shared.js";

async function attachContractEditContext(
  ctx: EngineContext,
  intent: TaskIntent,
  bundle: ResearchBundle,
  draft: ArtifactDraft,
): Promise<ArtifactDraft> {
  const seedSections = draftLooksLikeContractBody(draft, intent.instruction);
  try {
    const { draft: enriched } = await enrichDraftWithContractEditBaseline({
      workspaceDir: ctx.workspaceDir,
      draft,
      instruction: intent.instruction,
      bundle,
      seedSections,
    });
    return enriched;
  } catch {
    return stampContractEditBaselineIfNeeded({
      workspaceDir: ctx.workspaceDir,
      draft,
      instruction: intent.instruction,
      bundle,
    });
  }
}

class DraftCreationError extends Error {
  readonly code = "draft_role_not_allowed";
}

function resolveRoleForContext(ctx: EngineContext): ReturnType<typeof getRoleById> {
  if (!ctx.assistantId) {
    return undefined;
  }
  try {
    const lawMindRoot = resolveLawMindRoot(ctx.workspaceDir);
    const profile = getAssistantById(lawMindRoot, ctx.assistantId);
    return getRoleById(profile?.roleId ?? profile?.presetKey);
  } catch {
    return undefined;
  }
}

function ensureRoleAllowsDraft(ctx: EngineContext, intent: TaskIntent): void {
  const role = resolveRoleForContext(ctx);
  if (!role) {
    return;
  }
  const kind = classifyDeliverableKindFromIntent(intent);
  if (!roleAllowsDeliverable(role, kind)) {
    throw new DraftCreationError(
      `Role ${role.roleId} (${role.displayName}) is not allowed to draft deliverable kind "${kind}". ` +
        `Allowed: ${role.allowedDeliverableTypes.join(", ")}.`,
    );
  }
}

export function draftSync(
  ctx: EngineContext,
  intent: TaskIntent,
  bundle: ResearchBundle,
  opts: { title?: string; templateId?: string } = {},
): ArtifactDraft {
  ensureRoleAllowsDraft(ctx, intent);
  let draft = buildDraft({
    intent,
    bundle,
    title: opts.title,
    templateId: opts.templateId,
    workspaceDir: ctx.workspaceDir,
  });
  draft = stampContractEditBaselineIfNeeded({
    workspaceDir: ctx.workspaceDir,
    draft,
    instruction: intent.instruction,
    bundle,
  });
  persistDraftPipeline(ctx, draft, bundle);
  return draft;
}

export async function draftAsyncImpl(
  ctx: EngineContext,
  intent: TaskIntent,
  bundle: ResearchBundle,
  opts: {
    title?: string;
    templateId?: string;
    phaseTiming?: Record<string, number>;
  } = {},
): Promise<ArtifactDraft> {
  ensureRoleAllowsDraft(ctx, intent);
  const lawMindRoot = resolveLawMindRoot(ctx.workspaceDir);
  const record = (name: string, startedAt: number) => {
    if (opts.phaseTiming) {
      opts.phaseTiming[name] = Math.max(0, Date.now() - startedAt);
    }
  };
  let t = Date.now();
  let draft = await buildDraftAsync({
    intent,
    bundle,
    title: opts.title,
    templateId: opts.templateId,
    lawMindRoot,
    workspaceDir: ctx.workspaceDir,
  });
  record("draft_model", t);
  t = Date.now();
  draft = await attachContractEditContext(ctx, intent, bundle, draft);
  record("draft_contract_baseline", t);
  t = Date.now();
  const criticized = await runDraftCriticAsync(draft);
  record("draft_critic", t);
  draft = criticized.draft;
  persistClauseSnapshot(ctx.workspaceDir, criticized.graph);
  t = Date.now();
  persistDraftPipeline(ctx, draft, bundle);
  record("draft_persist", t);
  return draft;
}

export { DraftCreationError };
