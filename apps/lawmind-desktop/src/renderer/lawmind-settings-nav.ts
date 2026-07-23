/** Settings sidebar metadata (grouped nav + deep-link anchors). */

export type LawmindSettingsSectionId =
  | "doctor"
  | "appearance"
  | "review-prefs"
  | "memory"
  | "skills"
  | "collaboration"
  | "automations"
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
  /** Short caption under the page title (not a manual blurb). */
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
        description: "配置检查与快捷入口",
        keywords:
          "doctor 体检 健康 用量 索引 memory truth 真相源 overview 概览 内测 团队成长 基线 一次过",
      },
      {
        id: "models",
        label: "模型/API",
        description: "密钥、模型与检索",
        keywords: "model api key 检索 retrieval brave 联网",
      },
      {
        id: "workspace",
        label: "工作区",
        description: "数据目录与本机材料",
        keywords: "workspace 工作区 项目 project 目录",
      },
      {
        id: "appearance",
        label: "外观",
        description: "主题、字号与布局",
        keywords: "appearance 字体 字号 ui",
      },
      {
        id: "review-prefs",
        label: "审核偏好",
        description: "签批后导出",
        keywords: "review 审核 导出 word",
      },
      {
        id: "templates",
        label: "模板",
        description: "Word / PPT 交付模板",
        keywords: "templates 模板 docx word ppt pptx 文稿",
      },
      {
        id: "memory",
        label: "记忆库",
        description: "办案沉淀与助手进化",
        keywords: "memory 记忆 采纳 adoption 建议 沉淀 习惯 进化 学习",
      },
      {
        id: "skills",
        label: "技能库",
        description: "本地技能与中国法律包",
        keywords: "skills 技能 skill 签名 中国包 cn pack",
      },
      {
        id: "assistants",
        label: "助手与岗位",
        description: "切换助手与按领域新建",
        keywords: "assistant 智能体 岗位 persona 助手",
      },
    ],
  },
  {
    id: "advanced",
    label: "高级",
    items: [
      {
        id: "collaboration",
        label: "团队工作流",
        description: "在办入口与状态",
        keywords: "collaboration 协作 在办 委派 delegation",
      },
      {
        id: "automations",
        label: "自动办件",
        description: "定时任务与邮件",
        keywords: "automations 自动办件 定时 邮件 续签 周报 交办任务",
      },
      {
        id: "tools",
        label: "安全与工具",
        description: "高安全开关",
        keywords: "tools mcp 工具 沙箱 policy",
      },
      {
        id: "roles",
        label: "角色",
        description: "内置岗位说明",
        keywords: "roles 角色 助手 岗位",
      },
      {
        id: "edition",
        label: "版本与授权",
        description: "版本与能力一览",
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
        description: "检查更新",
        keywords: "update 更新 安装包",
      },
      {
        id: "disclaimer",
        label: "免责声明",
        description: "使用边界",
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
