/** Settings sidebar metadata (grouped nav + deep-link anchors). */

export type LawmindSettingsSectionId =
  | "doctor"
  | "appearance"
  | "review-prefs"
  | "memory"
  | "collaboration"
  | "assistants"
  | "models"
  | "workspace"
  | "tools"
  | "roles"
  | "templates"
  | "edition"
  | "app-update"
  | "disclaimer";

export const LAWMIND_SETTINGS_DEFAULT_SECTION: LawmindSettingsSectionId = "doctor";

/** Scroll targets inside a section (third arg to `setShowSettings`). */
export const LAWMIND_SETTINGS_SCROLL_ANCHORS = {
  memoryTruth: "lawmind-settings-memory-truth",
} as const;

export type LawmindSettingsScrollAnchorId =
  (typeof LAWMIND_SETTINGS_SCROLL_ANCHORS)[keyof typeof LAWMIND_SETTINGS_SCROLL_ANCHORS];

export type SettingsNavItem = {
  id: LawmindSettingsSectionId;
  label: string;
  description: string;
  keywords: string;
};

export type SettingsNavGroup = {
  id: string;
  label: string;
  items: SettingsNavItem[];
};

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    id: "general",
    label: "常规",
    items: [
      {
        id: "doctor",
        label: "开始使用",
        description: "确认基础配置和常用能力是否可用。",
        keywords: "doctor 体检 健康 用量 索引 memory truth 真相源 overview 概览",
      },
      {
        id: "models",
        label: "模型/API",
        description: "配置模型 API，让 LawMind 可以开始写材料和处理案件。",
        keywords: "model api key 检索 retrieval brave 联网",
      },
      {
        id: "workspace",
        label: "工作区",
        description: "设置数据保存位置和可选材料目录。",
        keywords: "workspace 工作区 项目 project 目录",
      },
      {
        id: "appearance",
        label: "外观",
        description: "调整界面字号等本机显示偏好。",
        keywords: "appearance 字体 字号 ui",
      },
      {
        id: "review-prefs",
        label: "审核偏好",
        description: "配置审核台签批后的导出与出稿方式。",
        keywords: "review 审核 导出 word",
      },
      {
        id: "templates",
        label: "模板",
        description: "管理常用 Word、PPT 和文稿模板。",
        keywords: "templates 模板 docx word ppt 文稿",
      },
      {
        id: "memory",
        label: "记忆库",
        description: "待采纳的记忆建议与采纳历史（与体检中的记忆真相源文件检查不同）。",
        keywords: "memory 记忆 采纳 adoption 建议",
      },
    ],
  },
  {
    id: "advanced",
    label: "高级",
    items: [
      {
        id: "assistants",
        label: "助手与岗位",
        description: "配置多助手、岗位和对话切换。日常使用通常无需调整。",
        keywords: "assistant 智能体 岗位 persona",
      },
      {
        id: "collaboration",
        label: "团队工作流",
        description: "多智能体协作和后台工作流。Solo 默认可不使用。",
        keywords: "collaboration 协作 工作流 delegation",
      },
      {
        id: "tools",
        label: "安全与工具",
        description: "高安全模式、工具批准和 MCP。默认策略已足够个人律师使用。",
        keywords: "tools mcp 工具 沙箱 policy",
      },
      {
        id: "roles",
        label: "角色",
        description: "工作区内智能体角色与权限配置。通常由模板自动选择。",
        keywords: "roles 角色",
      },
      {
        id: "edition",
        label: "版本与授权",
        description: "当前版本能力（Solo / Firm）与功能开关。",
        keywords: "edition 版本 firm solo 授权",
      },
    ],
  },
  {
    id: "about",
    label: "关于",
    items: [
      {
        id: "app-update",
        label: "应用更新",
        description: "检查更新与安装包下载。",
        keywords: "update 更新 安装包",
      },
      {
        id: "disclaimer",
        label: "免责声明",
        description: "产品使用边界与法律免责说明。",
        keywords: "disclaimer 免责",
      },
    ],
  },
] as const;

export const SETTINGS_NAV_FLAT: SettingsNavItem[] = SETTINGS_NAV_GROUPS.flatMap((g) => [...g.items]);

export function filterSettingsNavGroups(query: string): SettingsNavGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...SETTINGS_NAV_GROUPS];
  }
  return SETTINGS_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q),
    ),
  })).filter((group) => group.items.length > 0);
}

export function firstSettingsNavMatch(query: string): LawmindSettingsSectionId | undefined {
  return filterSettingsNavGroups(query)[0]?.items[0]?.id;
}

export function settingsNavItem(
  id: LawmindSettingsSectionId,
): SettingsNavItem | undefined {
  return SETTINGS_NAV_FLAT.find((item) => item.id === id);
}

export function lawmindSettingsSectionFromDomId(domId: string): LawmindSettingsSectionId | undefined {
  const suffix = domId.replace(/^lawmind-settings-/, "");
  if (suffix === "doctor" || suffix === "usage") {
    return "doctor";
  }
  if (SETTINGS_NAV_FLAT.some((item) => item.id === suffix)) {
    return suffix as LawmindSettingsSectionId;
  }
  return undefined;
}

const SETTINGS_LAST_SECTION_KEY = "lawmind.settings.lastSection";

export function readStoredSettingsSection(): LawmindSettingsSectionId {
  try {
    const raw = localStorage.getItem(SETTINGS_LAST_SECTION_KEY);
    if (raw && SETTINGS_NAV_FLAT.some((item) => item.id === raw)) {
      return raw as LawmindSettingsSectionId;
    }
  } catch {
    /* ignore */
  }
  return LAWMIND_SETTINGS_DEFAULT_SECTION;
}

export function writeStoredSettingsSection(sectionId: LawmindSettingsSectionId): void {
  try {
    localStorage.setItem(SETTINGS_LAST_SECTION_KEY, sectionId);
  } catch {
    /* ignore */
  }
}
