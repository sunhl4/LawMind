/**
 * 用户创建的助手档案（持久化在 LawMind 根目录 assistants.json）
 */

/** 智能体在「虚拟团队」中的组织角色，用于 Prompt 与设置展示（不替代律师责任）。 */
export type AssistantOrgRole = "lead" | "member" | "intern";

/**
 * 职务说明书：这个助手长期承担什么、边界在哪。
 *
 * 为什么单独成结构而不并进 `introduction`：Grok Bot 的公开口径是
 * 「Description 放恒久规则，Message 放本次任务」，且明确要求把安全边界
 * 写进描述而不是记忆。实测下来，把「禁止项 / 什么时候必须上报」混在
 * 一段自述简介里，模型会当成人设修辞而不是约束。
 *
 * 与 `customRoleInstructions` 的分工：那份是律所/律师自由补充的说明；
 * 这份是**结构化**的岗位边界，字段固定，因此可被单测与 UI 逐项核对。
 */
export type AssistantJobBrief = {
  /** 长期负责什么（一句话，操作性语言）。 */
  responsibility?: string;
  /** 主要输入来自哪里（案卷、邮箱、法宝、客户提供的材料…）。 */
  sources?: string;
  /** 交付什么才算办完。 */
  deliverables?: string;
  /** 绝对不做、或必须先问律师的事。这是最关键的一项。 */
  prohibitions?: string;
  /** 什么情况下停下来上报而不是自己决定。 */
  escalation?: string;
};

/** 说明书的字段顺序（UI 与提示词共用一处，避免两边漂移）。 */
export const ASSISTANT_JOB_BRIEF_FIELDS = [
  "responsibility",
  "sources",
  "deliverables",
  "prohibitions",
  "escalation",
] as const satisfies readonly (keyof AssistantJobBrief)[];

export const ASSISTANT_JOB_BRIEF_LABELS: Record<keyof AssistantJobBrief, string> = {
  responsibility: "长期负责",
  sources: "材料从哪来",
  deliverables: "交付什么算办完",
  prohibitions: "绝对不做/必须先问",
  escalation: "什么情况停下来问我",
};

/** 全空视为未填写；避免存一堆空字符串污染提示词。 */
export function normalizeAssistantJobBrief(
  brief: AssistantJobBrief | undefined,
): AssistantJobBrief | undefined {
  if (!brief) {
    return undefined;
  }
  const out: AssistantJobBrief = {};
  for (const field of ASSISTANT_JOB_BRIEF_FIELDS) {
    const value = brief[field]?.trim();
    if (value) {
      out[field] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type AssistantProfile = {
  assistantId: string;
  displayName: string;
  /** 助手简介，注入 system prompt */
  introduction: string;
  /** 结构化职务说明书（职责/材料/交付/禁止项/上报条件），注入 system prompt */
  jobBrief?: AssistantJobBrief;
  /** 可选：内置岗位 id，见 assistant-presets（W7 起被 roleId 取代，过渡期保留） */
  presetKey?: string;
  /**
   * W7：一等岗位（Role）的 id；默认从 presetKey 推导（同名）。
   * ToolPolicy / engine drafting 使用此字段消费 Role.allowedToolNames / riskCeiling /
   * allowedDeliverableTypes。未来 presetKey 字段将在一个季度后下线。
   */
  roleId?: string;
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
  /**
   * 置顶后排在名册和日常切换的前面。隐藏的助手即使置顶也不进日常切换。
   */
  pinned?: boolean;
  /**
   * 从顶栏日常切换里拿掉，名册里仍可找回。不删对话、案件或交付物。
   * 默认助手不能隐藏。
   */
  hidden?: boolean;
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
