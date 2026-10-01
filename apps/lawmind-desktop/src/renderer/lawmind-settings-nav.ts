/** Settings sidebar metadata (grouped nav + deep-link anchors). */

export type LawmindSettingsSectionId =
  | "account"
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
 * Lawyer-facing settings. Role / skills / edition / templates admin stay deep-linkable
 * (see SETTINGS_NAV_RETIRED_ITEMS) but are not in the sidebar.
 * The sidebar is a single flat list (Cursor-style); groups here are only source order.
 */
export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    id: "workspace",
    label: "本机与外观",
    items: [
      {
        id: "account",
        label: "账号",
        description: "登录身份、订阅方案与用量",
        keywords: "account profile 账号 账户 订阅 套餐 登录 用量 账单 会员 plan billing 许可 激活 激活码",
      },
      {
        id: "models",
        label: "模型与连接",
        description: "密钥、当前模型、联网与法源",
        keywords: "model api key 检索 retrieval brave 联网 密钥 连接 权威 法宝 法规库 数据源 pkulaw 垂类 共用",
      },
      {
        id: "workspace",
        label: "工作区",
        description: "案件数据目录、本机文件夹与办案标准",
        keywords: "workspace 工作区 项目 project 目录 扫描 历史材料 整理资料 旧卷宗 材料夹 文件夹 本机 标准 口径 playbook 查找 重建",
      },
      {
        id: "appearance",
        label: "外观",
        description: "浅色或深色、全软件字号，以及审稿是否要您拍板",
        keywords: "appearance 字体 字号 全局 ui 主题 深色 浅色 疏密 导出 word wps 加载项 签批 审阅 review 署名 修订作者",
      },
    ],
  },
  {
    id: "practice",
    label: "办案",
    items: [
      {
        id: "collaboration",
        label: "协作",
        description: "交出去的活，以及按流程办",
        keywords: "collaboration 协作 委派 按流程办",
      },
      {
        id: "automations",
        label: "自动办件",
        description: "选一件事，定多久办一次",
        keywords: "automations 自动办件 定时任务 定时 邮件 续签 周报 邮箱 落款",
      },
      {
        id: "memory",
        label: "记忆库",
        description: "办案沉淀与偏好学习",
        keywords: "memory 记忆 采纳 adoption 建议 沉淀 习惯 进化 学习",
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
] as const;

export const SETTINGS_NAV_FLAT: SettingsNavItem[] = SETTINGS_NAV_GROUPS.flatMap((g) => [...g.items]);

/** Retired from the sidebar; still routable so old lastSection / deep links do not crash. */
export const SETTINGS_NAV_RETIRED_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "assistants",
    label: "助手编制",
    description: "默认一位父助手即可；编制仅律所组织或深链使用",
    keywords: "assistant 智能体 岗位 persona 助手 编制 新建助手",
  },
  {
    id: "roles",
    label: "角色说明",
    description: "岗位已改为工作方式包，随办件与子工生效",
    keywords: "roles 角色 助手 岗位",
  },
  {
    id: "skills",
    label: "作业标准",
    description: "写在软件里，交办时自动带上，不能安装或开关",
    keywords: "skills 技能 skill 作业标准 内置",
  },
  {
    id: "edition",
    label: "版本与授权",
    description: "版本号见设置侧栏底部",
    keywords: "edition 版本 firm solo 授权",
  },
  {
    id: "doctor",
    label: "系统健康",
    description: "已收进工作区、外观与应用更新",
    keywords: "doctor 体检 健康",
  },
  {
    id: "templates",
    label: "文书模板",
    description: "出稿用内置模板，不能上传",
    keywords: "templates 模板 docx word ppt pptx 文稿",
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

/**
 * Sidebar for the active edition.
 * Solo: no 助手编制 (single parent agent — see LAWMIND-SINGLE-PARENT-AGENT).
 * Firm / private_deploy: 助手编制 appears under 办案 when multiAssistantRoster is on.
 */
export function settingsNavGroupsForEdition(
  edition: string | undefined,
  query = "",
): SettingsNavGroup[] {
  const groups = filterSettingsNavGroups(query);
  const ed = (edition ?? "solo").trim().toLowerCase();
  const showRoster = ed === "firm" || ed === "private_deploy";
  if (!showRoster) {
    return groups;
  }
  const assistantsItem = SETTINGS_NAV_RETIRED_ITEMS.find((item) => item.id === "assistants");
  if (!assistantsItem) {
    return groups;
  }
  const q = query.trim().toLowerCase();
  const assistantsMatchesQuery =
    !q ||
    assistantsItem.label.toLowerCase().includes(q) ||
    assistantsItem.description.toLowerCase().includes(q) ||
    assistantsItem.keywords.toLowerCase().includes(q);
  if (!assistantsMatchesQuery) {
    return groups;
  }

  const withAssistants = groups.map((group) => {
    if (group.id !== "practice") {
      return group;
    }
    if (group.items.some((item) => item.id === "assistants")) {
      return group;
    }
    return { ...group, items: [...group.items, assistantsItem] };
  });

  // Query matched only 助手编制 — practice group may have been filtered out entirely.
  if (!withAssistants.some((group) => group.id === "practice")) {
    return [
      ...withAssistants,
      { id: "practice", label: "办案", items: [assistantsItem] },
    ];
  }
  return withAssistants;
}

export function settingsNavItemsForEdition(
  edition?: string,
  query = "",
): SettingsNavItem[] {
  return settingsNavGroupsForEdition(edition, query).flatMap((group) => [...group.items]);
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
    return "workspace";
  }
  if (suffix === "review-prefs") {
    return "review-prefs";
  }
  if (suffix === "host") {
    return "workspace";
  }
  if (suffix === "tools") {
    return "models";
  }
  if (suffix === "app-update") {
    return "account";
  }
  if (SETTINGS_NAV_FLAT.some((item) => item.id === suffix) || SETTINGS_NAV_RETIRED_ITEMS.some((item) => item.id === suffix)) {
    return suffix as LawmindSettingsSectionId;
  }
  return undefined;
}

/** Sections still routable but removed from the sidebar (deep-link / legacy lastSection). */
export const SETTINGS_NAV_LEGACY_SECTION_IDS: readonly LawmindSettingsSectionId[] = [
  "review-prefs",
  "host",
  "assistants",
  "roles",
  "skills",
  "edition",
  "doctor",
  "tools",
  "templates",
  "app-update",
];

const RETIRED_LAST_SECTION_IDS = new Set<LawmindSettingsSectionId>([
  "roles",
  "skills",
  "edition",
  "doctor",
  "tools",
  "templates",
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
      if (raw === "host") {
        return "workspace";
      }
      if (raw === "doctor") {
        return "workspace";
      }
      if (raw === "tools") {
        return LAWMIND_SETTINGS_DEFAULT_SECTION;
      }
      if (raw === "app-update") {
        return "account";
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
