export const lawmindQueryKeys = {
  health: (apiBase: string) => ["lawmind", "health", apiBase] as const,
  bootstrap: (apiBase: string) => ["lawmind", "bootstrap", apiBase] as const,
  actionSummary: (apiBase: string, matterId?: string | null) =>
    ["lawmind", "action-summary", apiBase, matterId ?? ""] as const,
  matterOverviews: (apiBase: string) => ["lawmind", "matter-overviews", apiBase] as const,
  matterDetail: (apiBase: string, matterId: string) =>
    ["lawmind", "matter-detail", apiBase, matterId] as const,
  matterSessionTimeline: (apiBase: string, matterId: string) =>
    ["lawmind", "matter-session-timeline", apiBase, matterId] as const,
  matterAcceptance: (apiBase: string, matterId: string) =>
    ["lawmind", "matter-acceptance", apiBase, matterId] as const,
  reviewDraftList: (apiBase: string, matterId: string | null, listMode: string) =>
    ["lawmind", "review-drafts", apiBase, matterId ?? "", listMode] as const,
  reviewDraftDetail: (apiBase: string, taskId: string) =>
    ["lawmind", "review-draft", apiBase, taskId] as const,
};
