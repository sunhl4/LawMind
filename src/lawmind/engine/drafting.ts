/**
 * Engine — 步骤 3：draft / draftAsync。
 *
 * W7：若 EngineContext 关联到一个 Role 且 Role.allowedDeliverableTypes 不允许
 * 当前 deliverable kind，则拒绝（throw DraftCreationError）。Solo edition 仅 warn。
 */

import { getAssistantById, resolveLawMindRoot } from "../assistants/store.js";
import { getRoleById, roleAllowsDeliverable } from "../core/role.js";
import { buildDraft, buildDraftAsync, runDraftCriticAsync } from "../reasoning/index.js";
import type { ArtifactDraft, ResearchBundle, TaskIntent } from "../types.js";
import type { EngineContext } from "./context.js";
import { classifyDeliverableKindFromIntent } from "./role-helpers.js";
import { persistDraftPipeline } from "./shared.js";

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
  const draft = buildDraft({
    intent,
    bundle,
    title: opts.title,
    templateId: opts.templateId,
  });
  persistDraftPipeline(ctx, draft, bundle);
  return draft;
}

export async function draftAsyncImpl(
  ctx: EngineContext,
  intent: TaskIntent,
  bundle: ResearchBundle,
  opts: { title?: string; templateId?: string } = {},
): Promise<ArtifactDraft> {
  ensureRoleAllowsDraft(ctx, intent);
  const draft = await buildDraftAsync({
    intent,
    bundle,
    title: opts.title,
    templateId: opts.templateId,
  });
  const critiqued = await runDraftCriticAsync(draft);
  persistDraftPipeline(ctx, critiqued.draft, bundle, { clauseGraph: critiqued.graph });
  return critiqued.draft;
}

export { DraftCreationError };
