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

/** Day-1 landing: connect models first, not a health dashboard. */
export const LAWMIND_SETTINGS_DEFAULT_SECTION: LawmindSettingsSectionId = "models";

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

/**
 * Commercial IA: essentials first, knowledge second, professional controls collapsed for Solo.
 * Labels stay lawyer-facing; no toy/onboarding tone.
 */
export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    id: "workspace",
    label: "工作台",
    items: [
      {
        id: "models",
        label: "模型与连接",
        description: "API、默认模型与检索通道",
        keywords: "model api key 检索 retrieval brave 联网 密钥 连接 权威 法宝 法规库 数据源 pkulaw",
      },
      {
        id: "workspace",
        label: "工作区",
        description: "案件数据目录与本机材料",
        keywords: "workspace 工作区 项目 project 目录 扫描 历史材料",
      },
      {
        id: "appearance",
        label: "外观",
        description: "主题、字号、版面、签批审阅与导出",
        keywords: "appearance 字体 字号 ui 主题 导出 word 签批 审阅 红线 review 对外",
      },
    ],
  },
  {
    id: "knowledge",
    label: "知识",
    items: [
      {
        id: "templates",
        label: "文书模板",
        description: "Word / PPT 交付模板",
        keywords: "templates 模板 docx word ppt pptx 文稿",
      },
    ],
  },
  {
    id: "advanced",
    label: "专业控制",
    items: [
      {
        id: "doctor",
        label: "系统健康",
        description: "连接、核对与运行体检",
        keywords:
          "doctor 体检 健康 用量 索引 memory truth 真相源 overview 概览 内测 团队成长 基线 一次过 开始使用 北极星 无干预 逃逸",
      },
      {
        id: "memory",
        label: "记忆库",
        description: "办案沉淀与偏好学习",
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
        label: "助手编制",
        description: "岗位、领域与助手档案",
        keywords: "assistant 智能体 岗位 persona 助手 编制",
      },
      {
        id: "collaboration",
        label: "团队工作流",
        description: "在办入口与委派状态",
        keywords: "collaboration 协作 在办 委派 delegation",
      },
      {
        id: "automations",
        label: "自动办件",
        description: "定时任务与邮箱配置",
        keywords: "automations 自动办件 定时 邮件 续签 周报 交办任务 邮箱 落款",
      },
      {
        id: "tools",
        label: "安全与工具",
        description: "高安全开关与工具策略",
        keywords: "tools mcp 工具 沙箱 policy 安全",
      },
      {
        id: "roles",
        label: "角色说明",
        description: "内置岗位职责",
        keywords: "roles 角色 助手 岗位",
      },
    ],
  },
  {
    id: "about",
    label: "关于",
    items: [
      {
        id: "edition",
        label: "版本与授权",
        description: "产品版本与能力边界",
        keywords: "edition 版本 firm solo 授权",
      },
      {
        id: "app-update",
        label: "应用更新",
        description: "检查桌面版更新",
        keywords: "update 更新 安装包",
      },
      {
        id: "disclaimer",
        label: "免责声明",
        description: "使用边界与责任",
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

/** Solo: hide roles + collaboration from the sidebar (deep links still work). */
const SOLO_HIDDEN_SECTION_IDS = new Set<LawmindSettingsSectionId>([
  "roles",
  "collaboration",
  "assistants",
]);

/** Solo Day-1 sidebar: connect, folder, look, legal. Everything else is「更多设置」. */
const SOLO_DAY1_SECTION_IDS = new Set<LawmindSettingsSectionId>([
  "models",
  "workspace",
  "appearance",
  "disclaimer",
]);

function flattenNavItems(groups: SettingsNavGroup[]): SettingsNavItem[] {
  return groups.flatMap((group) => [...group.items]);
}

function soloDay1AndMoreGroups(groups: SettingsNavGroup[]): SettingsNavGroup[] {
  const items = flattenNavItems(groups);
  const day1 = items.filter((item) => SOLO_DAY1_SECTION_IDS.has(item.id));
  const more = items.filter((item) => !SOLO_DAY1_SECTION_IDS.has(item.id));
  const out: SettingsNavGroup[] = [];
  const workspaceItems = day1.filter((item) => item.id !== "disclaimer");
  const aboutItems = day1.filter((item) => item.id === "disclaimer");
  if (workspaceItems.length > 0) {
    out.push({ id: "workspace", label: "工作台", items: workspaceItems });
  }
  if (aboutItems.length > 0) {
    out.push({ id: "about", label: "关于", items: aboutItems });
  }
  if (more.length > 0) {
    out.push({ id: "more", label: "更多设置", items: more });
  }
  return out;
}

export function settingsNavGroupsForEdition(
  edition: string | undefined,
  query = "",
): SettingsNavGroup[] {
  const groups = filterSettingsNavGroups(query);
  if (edition !== "solo") {
    return groups;
  }
  const soloGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !SOLO_HIDDEN_SECTION_IDS.has(item.id)),
    }))
    .filter((group) => group.items.length > 0);
  if (query.trim()) {
    return soloGroups;
  }
  return soloDay1AndMoreGroups(soloGroups);
}

export function firstSettingsNavMatch(
  query: string,
  edition?: string,
): LawmindSettingsSectionId | undefined {
  return settingsNavGroupsForEdition(edition, query)[0]?.items[0]?.id;
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
  if (suffix === "review-prefs") {
    return "review-prefs";
  }
  if (SETTINGS_NAV_FLAT.some((item) => item.id === suffix)) {
    return suffix as LawmindSettingsSectionId;
  }
  return undefined;
}

/** Sections still routable but removed from the sidebar (deep-link / legacy lastSection). */
export const SETTINGS_NAV_LEGACY_SECTION_IDS: readonly LawmindSettingsSectionId[] = [
  "review-prefs",
];

export function isKnownSettingsSectionId(id: string): id is LawmindSettingsSectionId {
  return (
    SETTINGS_NAV_FLAT.some((item) => item.id === id) ||
    SETTINGS_NAV_LEGACY_SECTION_IDS.includes(id as LawmindSettingsSectionId)
  );
}

const SETTINGS_LAST_SECTION_KEY = "lawmind.settings.lastSection";

export function readStoredSettingsSection(): LawmindSettingsSectionId {
  try {
    const raw = localStorage.getItem(SETTINGS_LAST_SECTION_KEY);
    if (raw && isKnownSettingsSectionId(raw)) {
      // Legacy leaf: open appearance (auto-export lives there now).
      if (raw === "review-prefs") {
        return "appearance";
      }
      return raw;
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
