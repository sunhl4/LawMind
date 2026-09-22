/**
 * Codex-style legacy-path fragment: on pinned mail/Word short paths, rewriting
 * contract body via update_draft.sections is the old dual track. Fail that write
 * and inject a short craft warning — models ignore long system bans, but they
 * listen to a just-failed tool result plus a world-state craft patch.
 */

export const LEGACY_UPDATE_DRAFT_BODY_CODE = "legacy_update_draft_body";

/** Marker used to de-dupe the craft fragment. */
export const LEGACY_UPDATE_DRAFT_CRAFT_MARKER = "【改稿路径】";

/**
 * Keep this to ~3 sentences. Do not grow it into another system ban.
 * Seed (baseline path + seed_sections_from_baseline) is still the right update_draft use.
 */
export const LEGACY_UPDATE_DRAFT_BODY_WARNING =
  "【改稿路径】不要用 update_draft.sections 改正文（未写入）。请改走 apply_surgical_edits（最短 find/replace）。尚未 seed 时只传 contract_edit_baseline_path 与 seed_sections_from_baseline=true。";

export function isLockedContractEditTurn(ctx: {
  wordRevisionTurn?: boolean;
  mailContractTurn?: boolean;
}): boolean {
  return ctx.wordRevisionTurn === true || ctx.mailContractTurn === true;
}

export function shouldRejectLegacyUpdateDraftBody(
  params: { sections?: unknown },
  ctx: { wordRevisionTurn?: boolean; mailContractTurn?: boolean },
): boolean {
  return params.sections !== undefined && isLockedContractEditTurn(ctx);
}

export function noteLegacyUpdateDraftBodyWarning(ctx: {
  pendingWorldStateCraftPatch?: string;
}): void {
  ctx.pendingWorldStateCraftPatch = LEGACY_UPDATE_DRAFT_BODY_WARNING;
}

/** Read the failed-tool code; timeout middleware shallow-copies ctx so the tool itself cannot stick the patch. */
export function craftPatchFromToolResult(result: { data?: unknown }): string | undefined {
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  return (data as { code?: unknown }).code === LEGACY_UPDATE_DRAFT_BODY_CODE
    ? LEGACY_UPDATE_DRAFT_BODY_WARNING
    : undefined;
}

/** Write the craft fragment onto the shared (pre-copy) ctx after the tool pipeline returns. */
export function promoteLegacyUpdateDraftCraftPatch(
  ctx: { pendingWorldStateCraftPatch?: string },
  result: { data?: unknown },
): void {
  const patch = craftPatchFromToolResult(result);
  if (patch) {
    ctx.pendingWorldStateCraftPatch = patch;
  }
}

export function mergeLegacyUpdateDraftWarningIntoCraft(existing: string): string {
  const body = existing.trim();
  if (!body) {
    return LEGACY_UPDATE_DRAFT_BODY_WARNING;
  }
  if (body.includes(LEGACY_UPDATE_DRAFT_CRAFT_MARKER)) {
    return body;
  }
  return `${LEGACY_UPDATE_DRAFT_BODY_WARNING}\n\n${body}`;
}
