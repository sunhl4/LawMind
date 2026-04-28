/**
 * 用户创建的助手档案（持久化在 LawMind 根目录 assistants.json）
 */

/** 智能体在「虚拟团队」中的组织角色，用于 Prompt 与设置展示（不替代律师责任）。 */
export type AssistantOrgRole = "lead" | "member" | "intern";

export type AssistantProfile = {
  assistantId: string;
  displayName: string;
  /** 助手简介，注入 system prompt */
  introduction: string;
  /** 可选：内置岗位 id，见 assistant-presets */
  presetKey?: string;
  /** 自定义岗位标题（与预设并存时展示为副标题） */
  customRoleTitle?: string;
  /** 用户补充的岗位说明，与预设 prompt 拼接 */
  customRoleInstructions?: string;
  /**
   * 组织角色：主办 / 协办 / 实习辅助，便于多智能体协作时模型理解分工。
   */
  orgRole?: AssistantOrgRole;
  /**
   * 汇报对象（另一智能体的 assistantId）。不要求与真实律所一致，仅作协作与会话内层级提示。
   */
  reportsToAssistantId?: string;
  /**
   * 默认建议互审对象（assistantId）。模型可优先使用 `request_review` 指向该助手；仍以律师最终审核为准。
   */
  peerReviewDefaultAssistantId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantStatsEntry = {
  lastUsedAt: string;
  /** 成功完成的对话轮次（每次 chat turn +1） */
  turnCount: number;
  /** 与该助手关联的会话数（首次创建 session 时 +1） */
  sessionCount: number;
};

export type AssistantStatsFile = Record<string, AssistantStatsEntry>;
