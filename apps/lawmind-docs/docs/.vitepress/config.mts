import { defineConfig } from "vitepress";

/** 现行文档（与 docs/LAWMIND-REPO-LAYOUT.md 顶部「现行文档清单」一致）；历史文档在 /archive/ 下只读封存。 */
const guide = [
  { text: "律师快速指南", link: "/LAWMIND-LAWYER-QUICKSTART" },
  { text: "客户交付", link: "/LAWMIND-DELIVERY" },
  { text: "使用手册（完整版 · 归档）", link: "/archive/LAWMIND-USER-MANUAL" },
  { text: "客户一页概览（归档）", link: "/archive/LAWMIND-CUSTOMER-OVERVIEW" },
  { text: "客户验收（归档）", link: "/archive/LAWMIND-CUSTOMER-ACCEPTANCE" },
  { text: "数据处理（归档）", link: "/archive/LAWMIND-DATA-PROCESSING" },
  { text: "操作者与归因（归档）", link: "/archive/LAWMIND-ACTOR-ATTRIBUTION" },
];

const product = [
  { text: "架构", link: "/LAWMIND-ARCHITECTURE" },
  { text: "术语表", link: "/LAWMIND-TERMINOLOGY" },
  { text: "愿景（归档）", link: "/archive/LAWMIND-VISION" },
  { text: "Deliverable-First（归档）", link: "/archive/LAWMIND-DELIVERABLE-FIRST" },
  { text: "决策文档（归档）", link: "/archive/LAWMIND-DECISION" },
  { text: "2.0 战略（归档）", link: "/archive/LAWMIND-2.0-STRATEGY" },
];

const desktop = [
  { text: "桌面端 UI 约定（归档）", link: "/archive/LAWMIND-DESKTOP-UI" },
  { text: "桌面文件与上下文（归档）", link: "/archive/LAWMIND-DESKTOP-FILES-AND-CONTEXT" },
];

const ops = [
  { text: "Support Runbook（归档）", link: "/archive/LAWMIND-SUPPORT-RUNBOOK" },
  { text: "私有化部署（归档）", link: "/archive/LAWMIND-PRIVATE-DEPLOY" },
  { text: "安全清单（归档）", link: "/archive/LAWMIND-SECURITY-CHECKLIST" },
  { text: "包清单与校验（归档）", link: "/archive/LAWMIND-BUNDLES" },
  { text: "Policy 文件（归档）", link: "/archive/LAWMIND-POLICY-FILE" },
  { text: "联网检索（归档）", link: "/archive/LAWMIND-NETWORK-OPTIONS" },
  { text: "模型适配（归档）", link: "/archive/LAWMIND-MODEL-ADAPTERS" },
  { text: "集成与边界（归档）", link: "/archive/LAWMIND-INTEGRATIONS" },
];

const platform = [
  { text: "Platform Contracts", link: "/lawmind/LAWMIND-PLATFORM-CONTRACTS" },
  { text: "Platform Proxy", link: "/lawmind/LAWMIND-PLATFORM-PROXY" },
  { text: "Document Ingest", link: "/lawmind/LAWMIND-DOCUMENT-INGEST" },
  { text: "Big-Bang Cutover", link: "/lawmind/LAWMIND-BIGBANG-CUTOVER-ROLLBACK" },
  { text: "Collaboration UI/API（归档）", link: "/archive/LAWMIND-COLLABORATION-UI-API-MAP" },
];

const multitask = [
  { text: "Multitask Playbook", link: "/lawmind/LAWMIND-MULTITASK-PLAYBOOK" },
  { text: "Baseline Validation", link: "/lawmind/LAWMIND-MULTITASK-BASELINE-VALIDATION" },
  { text: "Check Matrix", link: "/lawmind/LAWMIND-MULTITASK-CHECK-MATRIX" },
  { text: "Developer Workflow", link: "/lawmind/DEVELOPER-WORKFLOW" },
];

const engineering = [
  { text: "未来问题", link: "/LAWMIND-FUTURE-ISSUES" },
  { text: "仓库目录结构", link: "/LAWMIND-REPO-LAYOUT" },
  { text: "法律编译器路线图", link: "/LAWMIND-LEGAL-COMPILER-ROADMAP" },
  { text: "归档区说明", link: "/archive/README" },
  { text: "三条铁律与改动清单（归档）", link: "/archive/LAWMIND-SIMPLE-RELIABLE-PLAN" },
  { text: "Engineering status", link: "/lawmind/engineering-status" },
  { text: "Compliance audit trail", link: "/lawmind/compliance-audit-trail" },
  { text: "Legal reasoning graph", link: "/lawmind/legal-reasoning-graph" },
  { text: "Agent workbench memory", link: "/lawmind/agent-workbench-memory" },
  { text: "Task checkpoints", link: "/lawmind/task-checkpoints" },
  { text: "Quality & benchmarks", link: "/lawmind/quality-and-benchmarks" },
  { text: "Citation & matter detail", link: "/lawmind/citation-and-matter-detail-memory" },
  { text: "Phase C governance", link: "/lawmind/phase-c-governance" },
  { text: "Phase D operability", link: "/lawmind/phase-d-operability" },
];

export default defineConfig({
  title: "LawMind",
  description: "LawMind — 律师本机工作台：合同审查、改稿签批与可交付文书",
  lang: "zh-Hans",
  cleanUrls: true,
  lastUpdated: true,
  /** Engineering notes link to repo-local paths and asset indexes; do not block product site ship. */
  ignoreDeadLinks: true,
  themeConfig: {
    logo: "/favicon.svg",
    siteTitle: "LawMind",
    nav: [
      { text: "快速指南", link: "/LAWMIND-LAWYER-QUICKSTART" },
      { text: "交付", link: "/LAWMIND-DELIVERY" },
      { text: "数据处理", link: "/archive/LAWMIND-DATA-PROCESSING" },
      {
        text: "下载",
        link: "/download/",
      },
      {
        text: "实施与支持",
        items: [
          { text: "私有化部署", link: "/archive/LAWMIND-PRIVATE-DEPLOY" },
          { text: "Support Runbook", link: "/archive/LAWMIND-SUPPORT-RUNBOOK" },
          { text: "集成与边界", link: "/archive/LAWMIND-INTEGRATIONS" },
          { text: "安全清单", link: "/archive/LAWMIND-SECURITY-CHECKLIST" },
        ],
      },
    ],
    sidebar: [
      {
        text: "入门与交付",
        collapsed: false,
        items: guide,
      },
      {
        text: "产品说明",
        collapsed: false,
        items: product,
      },
      {
        text: "桌面端",
        collapsed: true,
        items: desktop,
      },
      {
        text: "运维与信任",
        collapsed: true,
        items: ops,
      },
      {
        text: "平台契约",
        collapsed: true,
        items: platform,
      },
      {
        text: "Multitask 与发布",
        collapsed: true,
        items: multitask,
      },
      {
        text: "工程笔记",
        collapsed: true,
        items: engineering,
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
    footer: {
      message: "输出须经执业律师审阅后方可对外。LawMind 不构成法律意见。",
      copyright: "LawMind",
    },
  },
});
