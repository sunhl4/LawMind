/**
 * 内置岗位预设 — 注入 system prompt 的固定段落。
 * id 用于 AssistantProfile.presetKey。
 *
 * Phase B：每岗位可配置风险上限、验收清单、可选工具白名单（未设置则暴露全部已注册工具）。
 */

import type { RiskLevel } from "../types.js";

export type AssistantPresetDefinition = {
  id: string;
  displayName: string;
  /** 注入到「当前岗位与职责」章节的正文 */
  promptSection: string;
  /**
   * 岗位默认可接受的任务风险上限。
   * 高于此等级的任务类型或路由结果应在答复中明确提示「须律师确认后再交付」。
   */
  riskCeiling: RiskLevel;
  /** 交付前自检清单（注入 system prompt，供模型逐项核对） */
  acceptanceChecklist: string[];
  /**
   * 若设置，仅向模型暴露这些工具（OpenAI function name）。
   * 未设置或空数组表示不限制（与 Phase A 行为一致）。
   */
  allowedToolNames?: string[];
};

const CHECKLIST_CONTRACT = [
  "已区分「必须修改 / 建议优化 / 可选」",
  "重大风险与责任边界已前置说明",
  "引用或待核实处已标注来源或「待确认」",
  "争议解决与通知送达条款已审阅",
  "输出语气与受众（内部/客户/对方）一致",
] as const;

const CHECKLIST_LITIGATION = [
  "请求权基础与举证责任已厘清",
  "程序节点（时效、管辖、保全）已提示",
  "对抗主张与对方可能抗辩已覆盖",
  "需律师签章或盖章的交付物已标明不可直接发出",
] as const;

const CHECKLIST_COMPLIANCE = [
  "规范层级（法律/行政法规/规章）已区分",
  "生效日与适用范围已说明",
  "冲突规范的不同解释路径已列出",
  "结论以可复核清单呈现，避免唯一承诺式表述",
] as const;

const CHECKLIST_CLIENT = [
  "面向非法律人士时术语已适度解释",
  "行动建议与时间节点清晰",
  "敏感结论标注需律师最终把关",
  "篇幅与结构符合沟通场景（邮件/备忘录/汇报）",
] as const;

const CHECKLIST_DD = [
  "事实状态分为已核实 / 待补充 / 第三方待确认",
  "文件清单与缺口已列出",
  "多来源信息交叉处已说明",
] as const;

const CHECKLIST_DEFAULT = [
  "结论可追溯至来源或标注不确定性",
  "高风险交付物已提醒律师审批",
  "引用与事实未编造",
] as const;

export const ASSISTANT_PRESETS: AssistantPresetDefinition[] = [
  {
    id: "general_litigation",
    displayName: "诉讼与争议",
    riskCeiling: "high",
    acceptanceChecklist: [...CHECKLIST_LITIGATION],
    promptSection: `你侧重**诉讼与争议解决**相关工作。
- 优先厘清请求权基础、举证责任与程序节点；引用法条与类案时注明出处。
- 对外文书（起诉状、答辩状、律师函等）保持对抗策略清晰，并主动标注需律师确认的风险点。
- 检索时兼顾程序法与实体法，注意诉讼时效与管辖。`,
  },
  {
    id: "contract_review",
    displayName: "合同审查",
    riskCeiling: "medium",
    acceptanceChecklist: [...CHECKLIST_CONTRACT],
    promptSection: `你侧重**合同审查与交易条款**相关工作。
- 从权利义务、违约救济、保密与知识产权、争议解决条款等维度拆解；对模糊表述要求澄清或标注「待确认」。
- 输出时区分「必须修改」「建议优化」「可选」；重大风险前置说明。
- 善用 \`analyze_contract\` / \`execute_workflow\` 等工具形成可交付的审查意见结构。`,
  },
  {
    id: "compliance_research",
    displayName: "合规检索",
    riskCeiling: "medium",
    acceptanceChecklist: [...CHECKLIST_COMPLIANCE],
    promptSection: `你侧重**合规与监管检索**相关工作。
- 以规范层级（法律/行政法规/部门规章/行业标准）组织结论，并注明生效与适用范围。
- 对冲突或模糊地带明确列出不同解释路径及风险。
- 避免过度承诺「唯一结论」，以清单化、可复核的方式呈现。`,
  },
  {
    id: "client_memo",
    displayName: "客户沟通与备忘录",
    riskCeiling: "low",
    acceptanceChecklist: [...CHECKLIST_CLIENT],
    promptSection: `你侧重**客户沟通材料与工作备忘录**。
- 语言简洁、面向非法律人士时可适当解释术语，同时保留专业准确度。
- 突出行动建议与时间线；敏感结论标注需律师最终把关。
- 少用冗长论证，多用结构化小节与要点列表。`,
  },
  {
    id: "due_diligence",
    displayName: "尽调与材料整理",
    riskCeiling: "medium",
    acceptanceChecklist: [...CHECKLIST_DD],
    promptSection: `你侧重**尽职调查与材料梳理**。
- 强调事实核对、文件清单与缺口识别；区分「已核实」「待补充」「第三方待确认」。
- 输出表格化、可追溯；对同一事实的多来源信息做交叉说明。
- 大型任务分阶段汇总，避免一次性淹没细节。`,
  },
  {
    id: "general_default",
    displayName: "通用法律助理",
    riskCeiling: "high",
    acceptanceChecklist: [...CHECKLIST_DEFAULT],
    promptSection: `你是律所的**通用法律助理**，均衡处理检索、文书初稿与案件笔记。
- 按任务性质自动选择合适工具与工作流；高风险交付物提醒律师审批。
- 保持 LawMind 全局规范：可追溯、不编造法条、风险前置。`,
  },
];

const PRESET_BY_ID = new Map(ASSISTANT_PRESETS.map((p) => [p.id, p]));

export function getAssistantPreset(id: string | undefined): AssistantPresetDefinition | undefined {
  if (!id?.trim()) {
    return undefined;
  }
  return PRESET_BY_ID.get(id.trim());
}

export function listAssistantPresets(): AssistantPresetDefinition[] {
  return [...ASSISTANT_PRESETS];
}

/** 风险等级序（用于与任务 riskLevel 比较） */
const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * 当任务风险高于岗位上限时，应在答复中强调律师确认（供 UI/提示用）。
 */
export function taskRiskExceedsPresetCeiling(
  taskRisk: RiskLevel,
  preset: AssistantPresetDefinition | undefined,
): boolean {
  if (!preset) {
    return false;
  }
  return RISK_ORDER[taskRisk] > RISK_ORDER[preset.riskCeiling];
}
