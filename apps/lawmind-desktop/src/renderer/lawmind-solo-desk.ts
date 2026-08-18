/**
 * Solo Desk：个人律师默认不换房间。审核嵌在工作台右轨，不进独立「审核」页。
 */

export type DeskMainView = "workspace" | "collaboration" | "review";

export function isSoloDeskEdition(edition: string | undefined): boolean {
  return edition === "solo";
}

/** Solo 打开改稿时留在工作台，右轨嵌审核台。Firm 仍切 review 页。 */
export function shouldEmbedSoloReviewRail(edition: string | undefined): boolean {
  return isSoloDeskEdition(edition);
}

export function soloPrimaryTabLabel(tab: "workspace" | "review"): string {
  return tab === "workspace" ? "对话" : "改稿";
}

export function shouldShowCollaborationTab(edition: string | undefined): boolean {
  return !isSoloDeskEdition(edition);
}
