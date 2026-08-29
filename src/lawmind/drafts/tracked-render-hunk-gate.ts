/**
 * Contract tracked export must apply at least one AI/surgical redline hunk.
 * Prevents "format-correct but zero lawyer edits" fake completion.
 */

export const MIN_TRACKED_RENDER_HUNKS = 1;

export type TrackedRenderHunkGateResult =
  | { ok: true; proposalCount: number }
  | {
      ok: false;
      code: "redline_hunks_required";
      proposalCount: number;
      minHunks: number;
      message: string;
    };

export function evaluateTrackedRenderHunkGate(params: {
  /** draft.contractEdit present — surgical / baseline redline path */
  hasContractEdit: boolean;
  /** Non-rejected redline proposals ready to apply */
  proposalCount: number;
  /** Lawyer / test escape hatch */
  allowEmpty?: boolean;
  minHunks?: number;
}): TrackedRenderHunkGateResult {
  const minHunks = params.minHunks ?? MIN_TRACKED_RENDER_HUNKS;
  const count = Math.max(0, params.proposalCount);
  if (!params.hasContractEdit || params.allowEmpty === true || count >= minHunks) {
    return { ok: true, proposalCount: count };
  }
  return {
    ok: false,
    code: "redline_hunks_required",
    proposalCount: count,
    minHunks,
    message: [
      `合同审阅稿尚无待叠加修订（redline hunks=${count}，至少需要 ${minHunks}）。`,
      "请先用 apply_surgical_edits 落改（附 craft_check；按邮件/批注/己方实质风险与 Craft 原则），",
      "确认返回 data.redlinePending≥1 后再调用 render_tracked_draft。",
      "禁止仅写 summary 后空修订导出。",
    ].join(""),
  };
}
