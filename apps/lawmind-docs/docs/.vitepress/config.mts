import { defineConfig } from "vitepress";

const guide = [
  { text: "使用手册（完整版）", link: "/LAWMIND-USER-MANUAL" },
  { text: "客户一页概览", link: "/LAWMIND-CUSTOMER-OVERVIEW" },
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

const platform = [
  { text: "Platform Contracts", link: "/lawmind/LAWMIND-PLATFORM-CONTRACTS" },
  { text: "Platform Proxy", link: "/lawmind/LAWMIND-PLATFORM-PROXY" },
  { text: "Document Ingest", link: "/lawmind/LAWMIND-DOCUMENT-INGEST" },
  { text: "Big-Bang Cutover", link: "/lawmind/LAWMIND-BIGBANG-CUTOVER-ROLLBACK" },
  { text: "Collaboration UI/API", link: "/LAWMIND-COLLABORATION-UI-API-MAP" },
];

const multitask = [
  { text: "Multitask Playbook", link: "/lawmind/LAWMIND-MULTITASK-PLAYBOOK" },
  { text: "Baseline Validation", link: "/lawmind/LAWMIND-MULTITASK-BASELINE-VALIDATION" },
  { text: "Check Matrix", link: "/lawmind/LAWMIND-MULTITASK-CHECK-MATRIX" },
  { text: "Developer Workflow", link: "/lawmind/DEVELOPER-WORKFLOW" },
];

const engineering = [
  { text: "未来问题", link: "/LAWMIND-FUTURE-ISSUES" },
  { text: "三条铁律与改动清单", link: "/LAWMIND-SIMPLE-RELIABLE-PLAN" },
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
      { text: "使用手册", link: "/LAWMIND-USER-MANUAL" },
      { text: "交付", link: "/LAWMIND-DELIVERY" },
      { text: "数据处理", link: "/LAWMIND-DATA-PROCESSING" },
      {
        text: "下载",
        link: "/download/",
      },
      {
        text: "实施与支持",
        items: [
          { text: "私有化部署", link: "/LAWMIND-PRIVATE-DEPLOY" },
          { text: "Support Runbook", link: "/LAWMIND-SUPPORT-RUNBOOK" },
          { text: "集成与边界", link: "/LAWMIND-INTEGRATIONS" },
          { text: "安全清单", link: "/LAWMIND-SECURITY-CHECKLIST" },
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
