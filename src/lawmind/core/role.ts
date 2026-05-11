/**
 * Role — W7。
 *
 * 升级 6 个 assistant-presets 为一等业务对象 `Role`。Role 与 Assistant 解耦：
 *   - Assistant 是"具体的助手实例"（profile + 可用工具配置）。
 *   - Role 是"岗位定义"（mission / allowedToolNames / riskCeiling / memoryScope / reviewChecklist）。
 *
 * 每个 Assistant 通过 `roleId` 关联到一个 Role；W7 起 ToolPolicy pipeline 与
 * engine drafting 都消费 Role 的字段（allowedToolNames / riskCeiling / allowedDeliverableTypes）。
 *
 * 兼容：Assistant 的 `presetKey` 字段在一个季度内保留；启动时 migration 自动把
 * `presetKey` 推导为 `roleId`（见 `migrateAssistantsToRole`）。
 */

import type { AssistantPresetDefinition } from "../agent/assistant-presets.js";
import { ASSISTANT_PRESETS } from "../agent/assistant-presets.js";
import type { MemoryScope } from "../memory/adoption-service.js";
import type { RiskLevel } from "../types.js";
import type { DeliverableKind } from "./contracts.js";

export type Role = {
  /** 与原 preset.id 对齐，便于无声迁移。 */
  roleId: string;
  /** 显示名 */
  displayName: string;
  /** 一句话使命，注入 system prompt */
  mission: string;
  /** 允许调用的 OpenAI function names；undefined 表示不限制 */
  allowedToolNames?: string[];
  /** 允许产出的交付物类型（与 DeliverableSpec.kind 对齐） */
  allowedDeliverableTypes: DeliverableKind[];
  /** 该 Role 可以采纳/查看的记忆 scope */
  memoryScope: MemoryScope[];
  /** 任务风险上限 */
  riskCeiling: RiskLevel;
  /** 越级时默认的 escalateTo（roleId） */
  defaultEscalateTo?: string;
  /** 交付前自检清单（与 preset.acceptanceChecklist 对齐） */
  reviewChecklist: string[];
};

const COMMON_DELIVERABLES_FOR_LITIGATION: DeliverableKind[] = [
  "litigation-outline",
  "demand-letter",
  "legal-memo",
  "evidence-timeline",
];

const COMMON_DELIVERABLES_FOR_CONTRACT: DeliverableKind[] = [
  "contract-review",
  "legal-memo",
  "demand-letter",
];

const COMMON_DELIVERABLES_FOR_COMPLIANCE: DeliverableKind[] = ["legal-memo", "client-brief"];

const COMMON_DELIVERABLES_FOR_CLIENT: DeliverableKind[] = ["client-brief", "legal-memo"];

const COMMON_DELIVERABLES_FOR_DD: DeliverableKind[] = [
  "evidence-timeline",
  "legal-memo",
  "general-document",
];

const COMMON_DELIVERABLES_FOR_DEFAULT: DeliverableKind[] = [
  "legal-memo",
  "contract-review",
  "demand-letter",
  "litigation-outline",
  "client-brief",
  "evidence-timeline",
  "general-document",
];

const ROLE_DELIVERABLES: Record<string, DeliverableKind[]> = {
  general_litigation: COMMON_DELIVERABLES_FOR_LITIGATION,
  contract_review: COMMON_DELIVERABLES_FOR_CONTRACT,
  compliance_research: COMMON_DELIVERABLES_FOR_COMPLIANCE,
  client_memo: COMMON_DELIVERABLES_FOR_CLIENT,
  due_diligence: COMMON_DELIVERABLES_FOR_DD,
  general_default: COMMON_DELIVERABLES_FOR_DEFAULT,
};

const ROLE_MEMORY_SCOPES: Record<string, MemoryScope[]> = {
  general_litigation: ["matter", "lawyer", "client", "playbook", "opponent"],
  contract_review: ["matter", "lawyer", "client", "playbook"],
  compliance_research: ["firm", "lawyer", "playbook", "matter"],
  client_memo: ["client", "matter", "lawyer"],
  due_diligence: ["matter", "client", "lawyer"],
  general_default: [
    "matter",
    "lawyer",
    "client",
    "firm",
    "playbook",
    "opponent",
    "project",
    "assistant",
  ],
};

const ROLE_MISSION: Record<string, string> = {
  general_litigation: "驱动诉讼与争议解决工作，厘清请求权基础与程序节点。",
  contract_review: "驱动合同审查与交易条款拆解，按必须修改/建议优化/可选三档分级。",
  compliance_research: "提供以规范层级组织的合规检索结论，明确生效与适用范围。",
  client_memo: "面向非法律人士输出客户沟通材料，突出行动与时间线。",
  due_diligence: "推进尽职调查与材料梳理，区分已核实/待补充/第三方待确认。",
  general_default: "通用法律助理，按任务性质均衡处理检索、起草与笔记。",
};

const ROLE_ESCALATE: Record<string, string | undefined> = {
  general_litigation: "general_default",
  contract_review: "general_default",
  compliance_research: "general_default",
  client_memo: "general_default",
  due_diligence: "general_default",
  general_default: undefined,
};

function presetToRole(preset: AssistantPresetDefinition): Role {
  return {
    roleId: preset.id,
    displayName: preset.displayName,
    mission: ROLE_MISSION[preset.id] ?? preset.promptSection.split("\n")[0] ?? preset.displayName,
    allowedToolNames: preset.allowedToolNames,
    allowedDeliverableTypes: ROLE_DELIVERABLES[preset.id] ?? COMMON_DELIVERABLES_FOR_DEFAULT,
    memoryScope: ROLE_MEMORY_SCOPES[preset.id] ?? ROLE_MEMORY_SCOPES.general_default,
    riskCeiling: preset.riskCeiling,
    defaultEscalateTo: ROLE_ESCALATE[preset.id],
    reviewChecklist: [...preset.acceptanceChecklist],
  };
}

const BUILT_IN_ROLES: Role[] = ASSISTANT_PRESETS.map(presetToRole);
const ROLE_BY_ID = new Map(BUILT_IN_ROLES.map((r) => [r.roleId, r]));

export function listRoles(): Role[] {
  return [...BUILT_IN_ROLES];
}

export function getRoleById(roleId: string | undefined): Role | undefined {
  if (!roleId?.trim()) {
    return undefined;
  }
  return ROLE_BY_ID.get(roleId.trim());
}

/**
 * 根据 assistant 的 presetKey 推导 roleId（migration helper）。
 * 当前实现：roleId === presetKey；后续若有别名映射可在此扩展。
 */
export function deriveRoleIdFromPresetKey(presetKey: string | undefined): string | undefined {
  if (!presetKey?.trim()) {
    return undefined;
  }
  const trimmed = presetKey.trim();
  return ROLE_BY_ID.has(trimmed) ? trimmed : undefined;
}

/** 风险等级序，与 assistant-presets 共享。 */
const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function taskRiskExceedsRoleCeiling(taskRisk: RiskLevel, role: Role | undefined): boolean {
  if (!role) {
    return false;
  }
  return RISK_ORDER[taskRisk] > RISK_ORDER[role.riskCeiling];
}

/**
 * 检查 Role 是否允许产出某 deliverable kind。
 */
export function roleAllowsDeliverable(role: Role | undefined, kind: DeliverableKind): boolean {
  if (!role) {
    return true;
  }
  return role.allowedDeliverableTypes.includes(kind);
}
