/**
 * Edition feature gating — Solo / Firm / Private Deploy.
 *
 * 这是 Deliverable-First Architecture 的 P4：
 *   不同商业版本的 LawMind 看到的是同一份代码、同一份 workspace，
 *   但通过 `Edition` 闸门决定哪些**面板/能力/校验/导出**对当前用户可见或可用。
 *
 * 设计原则：
 *   1. 单一真相源：edition 来自 `LAWMIND_EDITION` 环境变量或 `lawmind.policy.json` 的 `edition` 字段（policy 优先）。
 *   2. 默认值 = `solo`，永远不报错（不存在「license 缺失」状态）。
 *   3. Edition 只决定显隐，不决定数据结构；任何 edition 写入的工作区都能被任何 edition 读取。
 *   4. 不在前端硬编码 feature 名；所有 feature key 在本文件 `EditionFeatures` 中集中声明，便于审计。
 */

import type { LawMindEdition, LawMindWorkspacePolicy } from "./workspace-policy.js";

const EDITION_VALUES: ReadonlyArray<LawMindEdition> = ["solo", "firm", "private_deploy"];

/** 各 edition 的人类可读标签（设置面板 / 状态条使用）。 */
export const EDITION_LABELS: Readonly<Record<LawMindEdition, string>> = {
  solo: "独立律师版",
  firm: "律所协作版",
  private_deploy: "私有化部署版",
};

/**
 * Feature flag 集中表。新增能力时**只**在这里添加，不在调用点硬编码。
 * `true` = 该 edition 默认开启；`false` = 隐藏或禁用。
 */
export const EDITION_FEATURES = {
  /** 验收门禁（Acceptance Gate）的 strict 模式：未通过禁止 render */
  acceptanceGateStrict: { solo: false, firm: true, private_deploy: true },
  /** 跨案件实验/Roadmap 决策卡（产品自我进化层） */
  crossMatterRoadmap: { solo: false, firm: true, private_deploy: true },
  /** 跨案件验收就绪概览（工作区级 `GET /api/acceptance-summary` 聚合 UI） */
  crossMatterAcceptanceDashboard: { solo: false, firm: true, private_deploy: true },
  /** 多律师协作摘要面板 */
  collaborationSummary: { solo: false, firm: true, private_deploy: true },
  /** 合规审计导出（compliance=true） */
  complianceAuditExport: { solo: false, firm: false, private_deploy: true },
  /** SBOM 与安全自检面板入口 */
  securitySbomPanel: { solo: false, firm: false, private_deploy: true },
  /** Quality dashboard JSON 自动导出 */
  qualityDashboardJsonExport: { solo: false, firm: true, private_deploy: true },
  /** 自定义 DeliverableSpec（律所专属合同/律师函） */
  customDeliverableSpec: { solo: false, firm: true, private_deploy: true },
  /** 客户验收包导出（acceptance-pack.md） */
  acceptancePackExport: { solo: false, firm: true, private_deploy: true },
  /**
   * 危险工具一律要求显式 `__approved: true`，不因开发环境 `allowDangerousToolsWithoutApproval` 绕过。
   * 并对 `execute_workflow` 等未标 `requiresApproval` 的长链路工具追加门禁。
   */
  strictDangerousToolApproval: { solo: false, firm: true, private_deploy: true },
} as const satisfies Record<string, Record<LawMindEdition, boolean>>;

export type EditionFeatureKey = keyof typeof EDITION_FEATURES;

/** Resolved edition + 元数据（供 `/api/health` / 设置面板回显）。 */
export type EditionContext = {
  edition: LawMindEdition;
  label: string;
  source: "policy_file" | "env" | "default";
  features: Readonly<Record<EditionFeatureKey, boolean>>;
};

function isEdition(value: unknown): value is LawMindEdition {
  return typeof value === "string" && (EDITION_VALUES as readonly string[]).includes(value);
}

/**
 * 解析当前生效的 edition。
 * 优先级：policy.edition > LAWMIND_EDITION env > "solo"。
 */
export function resolveEdition(opts?: {
  policy?: LawMindWorkspacePolicy | null;
  env?: NodeJS.ProcessEnv;
}): EditionContext {
  const policy = opts?.policy;
  const env = opts?.env ?? process.env;

  let edition: LawMindEdition = "solo";
  let source: EditionContext["source"] = "default";

  if (policy && isEdition(policy.edition)) {
    edition = policy.edition;
    source = "policy_file";
  } else {
    const raw = env.LAWMIND_EDITION?.trim().toLowerCase();
    if (isEdition(raw)) {
      edition = raw;
      source = "env";
    }
  }

  const features = Object.fromEntries(
    (Object.keys(EDITION_FEATURES) as EditionFeatureKey[]).map((key) => [
      key,
      EDITION_FEATURES[key][edition],
    ]),
  ) as Record<EditionFeatureKey, boolean>;

  return {
    edition,
    label: EDITION_LABELS[edition],
    source,
    features: Object.freeze(features),
  };
}

/**
 * 单 feature 查询的便捷函数。
 * 调用方应 prefer 这个函数而不是直接读 `EDITION_FEATURES[k][edition]`，
 * 因为它默认应用 policy 解析顺序。
 */
export function isFeatureEnabled(
  feature: EditionFeatureKey,
  opts?: { policy?: LawMindWorkspacePolicy | null; env?: NodeJS.ProcessEnv },
): boolean {
  return resolveEdition(opts).features[feature];
}

/** 所有有效 edition 字符串（供 schema 校验 / 设置面板枚举）。 */
export function listEditions(): ReadonlyArray<LawMindEdition> {
  return EDITION_VALUES;
}
