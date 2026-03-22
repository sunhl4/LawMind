/**
 * 用户创建的助手档案（持久化在 LawMind 根目录 assistants.json）
 */

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
