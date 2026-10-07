/**
 * 交办即终稿：模型不得以「须审核台放行」把出 Word 退回律师。
 * 反弹消息只给模型看（hiddenFromLawyer）。
 */

export const REVIEW_BOARD_EXPORT_BOUNCE_MARKER = "【交办即终稿·出 Word】";

/** 同一回合最多反弹一次；仍推诿则 scrub 律师面文案后收口。 */
export const REVIEW_BOARD_EXPORT_BOUNCE_MAX = 1;

/**
 * 识别「请律师去审核台放行才能出 Word / 工具未开」类推诿。
 * 须同时命中审核台放行语义与出稿/Word，避免误伤普通「审核」讨论。
 */
export function isReviewBoardExportDeferralReply(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12) {
    return false;
  }
  const asksRelease =
    /审核台/.test(trimmed) &&
    /放行/.test(trimmed) &&
    /(?:出\s*Word|导出|出稿|才能出)/i.test(trimmed);
  const claimsToolsClosed =
    /(?:改稿与导出工具未开|导出工具未开|本轮.{0,12}只读)/.test(trimmed) &&
    /(?:出\s*Word|导出|出稿|继续)/.test(trimmed);
  return asksRelease || claimsToolsClosed;
}

export function formatReviewBoardExportBounce(): string {
  return [
    `${REVIEW_BOARD_EXPORT_BOUNCE_MARKER}不要请律师去审核台放行才能出 Word。`,
    "- 检查单未覆盖、主体空白、法条未核到：写入稿内【待核实】或修订/批注，然后调用 render_tracked_draft。",
    "- 本回合改稿与导出工具可用（除非环境标明 readonly）。不要声称「工具未开」。",
    "- 立刻对尚未出 Word 的合同走 apply_surgical_edits（如需）→ render_tracked_draft。不要回复已完成。",
  ].join("\n");
}
