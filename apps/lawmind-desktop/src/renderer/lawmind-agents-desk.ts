/**
 * 「在办」页内分段（浅层 IA：顶栏只有「在办」，进度相关能力都收在这里）。
 * - active: 并行交办 / 待办总览（原 Agent Fleet）
 * - delegations: 交出去的活（原协作 overview）
 * - workflows: 按流程办（原团队工作流）
 */
export type AgentsDeskTab = "active" | "delegations" | "workflows";

/** @deprecated Prefer AgentsDeskTab; kept for short migration of collaboration desk props. */
export type CollaborationDeskTab = "overview" | "workflows";

export function agentsDeskTabFromLegacy(tab: CollaborationDeskTab): AgentsDeskTab {
  return tab === "workflows" ? "workflows" : "delegations";
}

export function legacyCollaborationTab(tab: AgentsDeskTab): CollaborationDeskTab {
  return tab === "workflows" ? "workflows" : "overview";
}
