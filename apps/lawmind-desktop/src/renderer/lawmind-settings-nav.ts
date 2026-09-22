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
  | "host"
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
 * Lawyer-facing settings. Role / skills / edition admin stay deep-linkable
 * (see SETTINGS_NAV_RETIRED_ITEMS) but are not in the sidebar.
 * 助手编制 is in 办案（Day-1 落在「更多设置」），便于新建助手。
 */
export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    id: "workspace",
    label: "本机与外观",
    items: [
      {
        id: "models",
        label: "模型与连接",
        description: "API、默认模型与检索通道",
        keywords: "model api key 检索 retrieval brave 联网 密钥 连接 权威 法宝 法规库 数据源 pkulaw 垂类 共用",
      },
      {
        id: "workspace",
        label: "工作区",
        description: "案件数据目录、材料夹与办案标准",
        keywords: "workspace 工作区 项目 project 目录 扫描 历史材料 材料夹 文件夹 标准 口径 playbook",
      },
      {
        id: "host",
        label: "本机能力",
        description: "本机查找、本机命令与案件隔离",
        keywords: "本机 查找 挂载 文件夹 host 命令 磁盘 索引",
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
    id: "practice",
    label: "办案",
    items: [
      {
        id: "automations",
        label: "自动办件",
        description: "定时任务与邮箱配置",
        keywords: "automations 自动办件 定时 邮件 续签 周报 交办任务 邮箱 落款",
      },
      {
        id: "templates",
        label: "文书模板",
        description: "Word / PPT 交付模板",
        keywords: "templates 模板 docx word ppt pptx 文稿",
      },
      {
        id: "memory",
        label: "记忆库",
        description: "办案沉淀与偏好学习",
        keywords: "memory 记忆 采纳 adoption 建议 沉淀 习惯 进化 学习",
      },
      {
        id: "assistants",
        label: "助手编制",
        description: "新建、切换与编辑助手",
        keywords: "assistant 智能体 岗位 persona 助手 编制 新建助手",
      },
    ],
  },
  {
    id: "about",
    label: "关于",
    items: [
      {
        id: "disclaimer",
        label: "免责声明",
        description: "使用边界与责任",
        keywords: "disclaimer 免责",
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
        id: "tools",
        label: "安全",
        description: "高安全开关与联网策略",
        keywords: "tools mcp 工具 沙箱 policy 安全 高安全",
      },
      {
        id: "app-update",
        label: "应用更新",
        description: "检查桌面版更新",
        keywords: "update 更新 安装包",
      },
    ],
  },
] as const;

export const SETTINGS_NAV_FLAT: SettingsNavItem[] = SETTINGS_NAV_GROUPS.flatMap((g) => [...g.items]);

/** Retired from the sidebar; still routable so old lastSection / deep links do not crash. */
export const SETTINGS_NAV_RETIRED_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "roles",
    label: "角色说明",
    description: "内置岗位已随默认助手生效",
    keywords: "roles 角色 助手 岗位",
  },
  {
    id: "collaboration",
    label: "团队工作流",
    description: "日常入口是顶栏「在办」",
    keywords: "collaboration 协作 在办 委派 delegation",
  },
  {
    id: "skills",
    label: "技能库",
    description: "开箱技能自动启用，不必在此开关",
    keywords: "skills 技能 skill 签名 中国包 cn pack",
  },
  {
    id: "edition",
    label: "版本与授权",
    description: "版本号见设置侧栏底部",
    keywords: "edition 版本 firm solo 授权",
  },
];

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

/** Day-1 sidebar: connect, folders, host, look, legal. Everything else is「更多设置」. */
const DAY1_SECTION_IDS = new Set<LawmindSettingsSectionId>([
  "models",
  "workspace",
  "host",
  "appearance",
  "disclaimer",
]);

function flattenNavItems(groups: SettingsNavGroup[]): SettingsNavItem[] {
  return groups.flatMap((group) => [...group.items]);
}

function day1AndMoreGroups(groups: SettingsNavGroup[]): SettingsNavGroup[] {
  const items = flattenNavItems(groups);
  const day1 = items.filter((item) => DAY1_SECTION_IDS.has(item.id));
  const more = items.filter((item) => !DAY1_SECTION_IDS.has(item.id));
  const out: SettingsNavGroup[] = [];
  const workspaceItems = day1.filter((item) => item.id !== "disclaimer");
  const aboutItems = day1.filter((item) => item.id === "disclaimer");
  if (workspaceItems.length > 0) {
    out.push({ id: "workspace", label: "本机与外观", items: workspaceItems });
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
  _edition: string | undefined,
  query = "",
): SettingsNavGroup[] {
  const groups = filterSettingsNavGroups(query);
  if (query.trim()) {
    return groups;
  }
  return day1AndMoreGroups(groups);
}

export function firstSettingsNavMatch(
  query: string,
  edition?: string,
): LawmindSettingsSectionId | undefined {
  return settingsNavGroupsForEdition(edition, query)[0]?.items[0]?.id;
}

export function settingsNavItem(id: LawmindSettingsSectionId): SettingsNavItem | undefined {
  return SETTINGS_NAV_FLAT.find((item) => item.id === id) ?? SETTINGS_NAV_RETIRED_ITEMS.find((item) => item.id === id);
}

export function lawmindSettingsSectionFromDomId(domId: string): LawmindSettingsSectionId | undefined {
  const suffix = domId.replace(/^lawmind-settings-/, "");
  if (suffix === "doctor" || suffix === "usage") {
    return "doctor";
  }
  if (suffix === "review-prefs") {
    return "review-prefs";
  }
  if (SETTINGS_NAV_FLAT.some((item) => item.id === suffix) || SETTINGS_NAV_RETIRED_ITEMS.some((item) => item.id === suffix)) {
    return suffix as LawmindSettingsSectionId;
  }
  return undefined;
}

/** Sections still routable but removed from the sidebar (deep-link / legacy lastSection). */
export const SETTINGS_NAV_LEGACY_SECTION_IDS: readonly LawmindSettingsSectionId[] = [
  "review-prefs",
  "roles",
  "collaboration",
  "skills",
  "edition",
];

const RETIRED_LAST_SECTION_IDS = new Set<LawmindSettingsSectionId>([
  "roles",
  "collaboration",
  "skills",
  "edition",
]);

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
      if (raw === "review-prefs") {
        return "appearance";
      }
      if (RETIRED_LAST_SECTION_IDS.has(raw)) {
        return LAWMIND_SETTINGS_DEFAULT_SECTION;
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
