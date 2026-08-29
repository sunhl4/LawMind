/**
 * 「在办」页内分段（浅层 IA：顶栏只有「在办」，进度相关能力都收在这里）。
 * - active: 并行交办 / 待办总览（原 Agent Fleet）
 * - delegations: 交出去的活（原协作 overview）
 * - workflows: 按流程办（原团队工作流）
 */
export type AgentsDeskTab = "active" | "delegations" | "workflows";

/** 对话「去在办补充」等入口：定位到具体待办行，而非只打开在办页。 */
export type NeedsDecisionDeskTarget = {
  sessionId?: string;
  taskId?: string;
  matterId?: string;
  /** 交办 inbox 条目 id（fleet 行 `automation-send:<id>` / `queueItemId`）。 */
  queueItemId?: string;
  /** 工作流 job id（fleet 行 `jobId`，或「按流程办」深链）。 */
  jobId?: string;
  preferStatus?: "awaiting_clarification" | "awaiting_approval" | "awaiting_review";
};

/** 「按流程办」深链：预填案件并高亮/接上对应 job。 */
export type AgentsWorkflowFocusTarget = {
  matterId?: string;
  jobId?: string;
};

/** @deprecated Prefer AgentsDeskTab; kept for short migration of collaboration desk props. */
export type CollaborationDeskTab = "overview" | "workflows";

export function agentsDeskTabFromLegacy(tab: CollaborationDeskTab): AgentsDeskTab {
  return tab === "workflows" ? "workflows" : "delegations";
}

export function legacyCollaborationTab(tab: AgentsDeskTab): CollaborationDeskTab {
  return tab === "workflows" ? "workflows" : "overview";
}
