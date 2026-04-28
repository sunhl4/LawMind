import { defineConfig } from "vitepress";

const guide = [
  { text: "使用手册（完整版）", link: "/LAWMIND-USER-MANUAL" },
  { text: "客户一页概览（英）", link: "/LAWMIND-CUSTOMER-OVERVIEW" },
  { text: "客户交付", link: "/LAWMIND-DELIVERY" },
  { text: "客户验收", link: "/LAWMIND-CUSTOMER-ACCEPTANCE" },
  { text: "数据处理", link: "/LAWMIND-DATA-PROCESSING" },
  { text: "操作者与归因", link: "/LAWMIND-ACTOR-ATTRIBUTION" },
];

const product = [
  { text: "愿景", link: "/LAWMIND-VISION" },
  { text: "Deliverable-First（DFA）", link: "/LAWMIND-DELIVERABLE-FIRST" },
  { text: "决策文档", link: "/LAWMIND-DECISION" },
  { text: "2.0 战略", link: "/LAWMIND-2.0-STRATEGY" },
  { text: "架构", link: "/LAWMIND-ARCHITECTURE" },
  { text: "项目与记忆", link: "/LAWMIND-PROJECT-MEMORY" },
];

const desktop = [
  { text: "桌面端 UI 约定", link: "/LAWMIND-DESKTOP-UI" },
  { text: "桌面文件与上下文", link: "/LAWMIND-DESKTOP-FILES-AND-CONTEXT" },
];

const ops = [
  { text: "Support Runbook", link: "/LAWMIND-SUPPORT-RUNBOOK" },
  { text: "私有化部署", link: "/LAWMIND-PRIVATE-DEPLOY" },
  { text: "安全清单", link: "/LAWMIND-SECURITY-CHECKLIST" },
  { text: "包清单与校验", link: "/LAWMIND-BUNDLES" },
  { text: "Policy 文件", link: "/LAWMIND-POLICY-FILE" },
  { text: "联网检索", link: "/LAWMIND-NETWORK-OPTIONS" },
  { text: "模型适配", link: "/LAWMIND-MODEL-ADAPTERS" },
  { text: "集成与边界", link: "/LAWMIND-INTEGRATIONS" },
];

const engineering = [
  { text: "仓库目录结构", link: "/LAWMIND-REPO-LAYOUT" },
  { text: "Engineering status", link: "/lawmind/engineering-status" },
  { text: "Compliance audit trail", link: "/lawmind/compliance-audit-trail" },
  { text: "Legal reasoning graph", link: "/lawmind/legal-reasoning-graph" },
  { text: "Agent workbench memory", link: "/lawmind/agent-workbench-memory" },
  { text: "Task checkpoints", link: "/lawmind/task-checkpoints" },
  { text: "Quality & benchmarks", link: "/lawmind/quality-and-benchmarks" },
  { text: "Citation & matter detail", link: "/lawmind/citation-and-matter-detail-memory" },
  { text: "Phase C governance", link: "/lawmind/phase-c-governance" },
  { text: "Phase D operability", link: "/lawmind/phase-d-operability" },
  { text: "Refactor blueprint", link: "/lawmind/refactor-blueprint" },
  { text: "Refactor implementation", link: "/lawmind/refactor-implementation-plan" },
];

const lessons = [{ text: "通用多通道栈经验对照", link: "/LAWMIND-OPENCLAW-LESSONS" }];

export default defineConfig({
  title: "LawMind",
  description: "LawMind — 律师本机工作台文档",
  lang: "zh-Hans",
  cleanUrls: true,
  lastUpdated: true,
  /** 本站仅为 LawMind 子集；文中含 monorepo 相对路径与全站 legal 占位链。 */
  ignoreDeadLinks: [
    /^https?:\/\//,
    /^\/legal\//,
    /^\.\/legal\//,
    /^\.\.\/apps\//,
    /^\.\/\.\.\/apps\//,
    /^\.\/docs\//,
  ],
  themeConfig: {
    logo: "/favicon.svg",
    nav: [
      { text: "使用手册", link: "/LAWMIND-USER-MANUAL" },
      { text: "DFA", link: "/LAWMIND-DELIVERABLE-FIRST" },
      { text: "交付", link: "/LAWMIND-DELIVERY" },
      {
        text: "工程深潜",
        items: engineering.slice(0, 6),
      },
    ],
    sidebar: [
      {
        text: "入门与交付",
        collapsed: false,
        items: guide,
      },
      {
        text: "产品与战略",
        collapsed: false,
        items: product,
      },
      {
        text: "桌面端",
        collapsed: false,
        items: desktop,
      },
      {
        text: "运维与信任",
        collapsed: false,
        items: ops,
      },
      {
        text: "工程笔记（lawmind/）",
        collapsed: true,
        items: engineering,
      },
      {
        text: "工程协同",
        collapsed: true,
        items: lessons,
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/lawmind/lawmind" }],
    outline: {
      level: "deep",
      label: "本页目录",
    },
    docFooter: {
      prev: "上一篇",
      next: "下一篇",
    },
    search: {
      provider: "local",
    },
  },
});
