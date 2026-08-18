/**
 * Solo Desk：个人律师默认不换房间。审核与案件驾驶舱都嵌在工作台右列，不进独立页。
 */

export type DeskMainView = "workspace" | "collaboration" | "review";

export function isSoloDeskEdition(edition: string | undefined): boolean {
  return edition === "solo";
}

export type SoloDeskSurfacePane = "chat" | "review" | "matter";

/** Solo 打开改稿时留在工作台，右轨嵌审核台。Firm 仍切 review 页。 */
export function shouldEmbedSoloReviewRail(edition: string | undefined): boolean {
  return isSoloDeskEdition(edition);
}

/** Solo 打开案件时留在工作台，对话列嵌驾驶舱。Firm 仍整页替换。 */
export function shouldEmbedSoloMatterRail(edition: string | undefined): boolean {
  return isSoloDeskEdition(edition);
}

export function soloDeskSurfacePane(input: {
  edition?: string;
  reviewRail: boolean;
  matterOpen: boolean;
}): SoloDeskSurfacePane {
  if (!isSoloDeskEdition(input.edition)) {
    return "chat";
  }
  if (input.reviewRail) {
    return "review";
  }
  if (input.matterOpen) {
    return "matter";
  }
  return "chat";
}

/** Firm 才用整页案件工作台盖住文件+对话。 */
export function shouldReplaceWorkspaceWithMatterPage(
  edition: string | undefined,
  matterOpen: boolean,
): boolean {
  return matterOpen && !isSoloDeskEdition(edition);
}

export function soloPrimaryTabLabel(tab: "workspace" | "review"): string {
  return tab === "workspace" ? "对话" : "改稿";
}

export function shouldShowCollaborationTab(edition: string | undefined): boolean {
  return !isSoloDeskEdition(edition);
}

/** Solo 不进独立审核/协作页；若被深链拉走，弹回工作台。 */
export function shouldBounceSoloOffRoom(edition: string | undefined, view: DeskMainView): boolean {
  if (!isSoloDeskEdition(edition)) {
    return false;
  }
  return view === "review" || view === "collaboration";
}

export type SettingsSectionId =
  | "onboarding"
  | "collaboration"
  | "assistants"
  | "model"
  | "workspace"
  | "roles"
  | "templates"
  | "edition"
  | "update"
  | "disclaimer";

/** Solo 设置只留连模型、选工作区、助手与声明。Firm 全开。 */
export function shouldShowSettingsSection(
  edition: string | undefined,
  section: SettingsSectionId,
): boolean {
  if (!isSoloDeskEdition(edition)) {
    return true;
  }
  return (
    section !== "collaboration" &&
    section !== "roles" &&
    section !== "templates" &&
    section !== "edition"
  );
}

export function settingsLeadCopy(edition: string | undefined): string {
  if (isSoloDeskEdition(edition)) {
    return "连上模型、选好办案材料文件夹，就可以在这一页写和改稿。";
  }
  return "本机律师工作台：可建多个智能体各管一摊事；多步团队流程与后台任务在顶部协作页运行与查看。出具对外材料前，务必在顶部审核里通过把关。";
}

export function settingsAssistantsEmptyCopy(edition: string | undefined): string {
  if (isSoloDeskEdition(edition)) {
    return "还没有助手。建一个即可，对话和改稿都在这一页完成。";
  }
  return "可按岗位建多个（例如研究 / 起草 / 复核）；对话里随时切换。复杂事项还可在「协作」里跑多智能体工作流，交付前仍由您在审核台把关。";
}

export function shouldShowEditionBadge(edition: string | undefined): boolean {
  return !isSoloDeskEdition(edition);
}

export function shouldShowComposePlanPicker(edition: string | undefined): boolean {
  return !isSoloDeskEdition(edition);
}

/** Solo 审核栏不展示律所学习队列 / 助手档案；律师个人积累仍保留。 */
export function shouldShowReviewFirmLearningControls(edition: string | undefined): boolean {
  return !isSoloDeskEdition(edition);
}

export function reviewRejectedNextStepCopy(edition: string | undefined, hasMatter: boolean): string {
  const base =
    "不会。驳回后也不会自动删稿。若仍要交付，请在主对话中说明如何修改或重做；需要重新签批时，可先点「恢复待审核」。";
  if (!hasMatter) {
    return base;
  }
  if (isSoloDeskEdition(edition)) {
    return `${base} 本案对话列里的案件驾驶舱可能出现待修订条目。`;
  }
  return `${base} 关联案件工作台可能出现「草稿待修订」类待办，便于跟进。`;
}
