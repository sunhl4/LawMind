/**
 * Built-in deliverable specs.
 *
 * 每个 spec 描述一个可商业化的交付物类型，包含：
 *   - 必要章节（律师工作惯例）
 *   - 验收清单
 *   - 占位符规则
 *   - 默认追问
 *
 * 新增 spec 时只需要在这里追加并加入 BUILT_IN_DELIVERABLE_SPECS。
 * 业务方（router / engine / agent / desktop）通过 `getDeliverableSpec` 查询。
 */

import type { DeliverableType } from "../types.js";
import type { DeliverableSpec } from "./types.js";

const PLACEHOLDER_PATTERN = /【待补充[:：][^】]*】/g;

const RENTAL_CONTRACT_SPEC: DeliverableSpec = {
  type: "contract.rental",
  displayName: "房屋租赁合同",
  description:
    "完整可签署的房屋租赁合同正文，含双方主体、标的、租期、租金、押金、维修、违约与解除条款。",
  defaultTemplateId: "contract-rental-default",
  defaultOutput: "docx",
  defaultRiskLevel: "medium",
  requiredSections: [
    {
      headingKeywords: ["主体", "出租人", "承租人", "甲方", "乙方"],
      purpose: "合同双方信息",
      severity: "blocker",
    },
    {
      headingKeywords: ["房屋", "标的", "坐落", "地址"],
      purpose: "租赁标的描述",
      severity: "blocker",
    },
    { headingKeywords: ["租期", "期限"], purpose: "租赁期限", severity: "blocker" },
    { headingKeywords: ["租金", "押金", "支付"], purpose: "价款与支付安排", severity: "blocker" },
    { headingKeywords: ["维修", "费用"], purpose: "维修与费用承担", severity: "warning" },
    { headingKeywords: ["违约", "解除"], purpose: "违约责任与解除", severity: "blocker" },
    { headingKeywords: ["争议", "管辖", "适用法律"], purpose: "争议解决", severity: "warning" },
    { headingKeywords: ["签署", "落款", "签字"], purpose: "签署页", severity: "blocker" },
  ],
  acceptanceCriteria: [
    "输出完整合同正文，而不是摘要或审查意见。",
    "至少包含主体、房屋信息、租期、租金押金、维修费用、违约责任、解除续租、争议解决和签署页。",
    "缺失关键变量必须以显式占位符标记，不得静默编造。",
  ],
  placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
  defaultClarificationQuestions: [
    {
      key: "parties",
      question: "请补充出租人和承租人的姓名/名称及身份信息。",
      reason: "租赁合同必须明确双方主体。",
    },
    {
      key: "property_address",
      question: "请补充房屋地址、面积和用途。",
      reason: "标的描述不完整影响合同可执行性。",
    },
    {
      key: "lease_term",
      question: "请补充租赁期限和起止时间。",
      reason: "租期是租赁合同核心条款。",
    },
    {
      key: "rent_and_deposit",
      question: "请补充租金、押金和支付周期。",
      reason: "价款与支付安排是完整交付必需信息。",
    },
  ],
};

const GENERAL_CONTRACT_SPEC: DeliverableSpec = {
  type: "contract.general",
  displayName: "通用商务合同",
  description: "通用合同/协议草案，包含主体、标的、价款、履行、违约、争议解决与签署。",
  defaultTemplateId: "contract-general-default",
  defaultOutput: "docx",
  defaultRiskLevel: "medium",
  requiredSections: [
    {
      headingKeywords: ["主体", "甲方", "乙方", "签约方"],
      purpose: "签约主体",
      severity: "blocker",
    },
    { headingKeywords: ["标的", "服务", "交易"], purpose: "合同标的", severity: "blocker" },
    {
      headingKeywords: ["价款", "对价", "费用", "报酬"],
      purpose: "价款/对价",
      severity: "blocker",
    },
    { headingKeywords: ["履行", "交付", "时间"], purpose: "履行方式", severity: "warning" },
    { headingKeywords: ["违约", "责任"], purpose: "违约责任", severity: "blocker" },
    { headingKeywords: ["争议", "管辖"], purpose: "争议解决", severity: "warning" },
    { headingKeywords: ["签署", "签字", "落款"], purpose: "签署条款", severity: "blocker" },
  ],
  acceptanceCriteria: [
    "输出完整合同草案正文，而不是检索摘要。",
    "包含主体、标的、价款/对价、履行方式、违约责任、争议解决和签署条款。",
    "缺失关键变量使用显式占位符。",
  ],
  placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
  defaultClarificationQuestions: [
    {
      key: "parties_and_subject",
      question: "请补充合同双方、标的与核心商务条款；若暂无，我会先生成带占位符的草案。",
      reason: "完整合同需要主体与标的明确。",
    },
  ],
};

const DEMAND_LETTER_SPEC: DeliverableSpec = {
  type: "letter.demand",
  displayName: "律师函 / 催告函",
  description: "正式的律师函正文，包含事实背景、法律主张、履行期限、法律后果与落款。",
  defaultTemplateId: "letter-demand-default",
  defaultOutput: "docx",
  defaultRiskLevel: "high",
  requiredSections: [
    { headingKeywords: ["收函", "致", "受函人"], purpose: "收件方", severity: "blocker" },
    { headingKeywords: ["事实", "背景"], purpose: "事实背景", severity: "blocker" },
    { headingKeywords: ["主张", "请求", "诉求"], purpose: "法律主张", severity: "blocker" },
    { headingKeywords: ["期限", "履行"], purpose: "履行期限", severity: "blocker" },
    {
      headingKeywords: ["法律后果", "后果", "保留"],
      purpose: "法律后果与权利保留",
      severity: "warning",
    },
    { headingKeywords: ["落款", "签发", "律师事务所"], purpose: "落款与签发", severity: "blocker" },
  ],
  acceptanceCriteria: [
    "输出完整律师函/通知函正文。",
    "必须包含事实背景、主张、履行期限、法律后果和落款。",
    "口吻克制、表达专业，不掺杂内部分析。",
  ],
  placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: true },
  defaultClarificationQuestions: [
    {
      key: "claim_deadline",
      question: "请补充收函对象、核心违约事实和要求履行期限；若暂无，我会先生成标准律师函框架。",
      reason: "律师函需要明确对象、主张和期限。",
    },
  ],
};

const CONTRACT_REVIEW_SPEC: DeliverableSpec = {
  type: "contract.review",
  displayName: "合同审查意见",
  description: "针对待审合同的正式审查意见，包含审查结论、主要风险、修改建议和待确认事项。",
  defaultTemplateId: "review-contract-default",
  defaultOutput: "docx",
  defaultRiskLevel: "medium",
  requiredSections: [
    { headingKeywords: ["审查", "结论", "综合", "总评"], purpose: "审查结论", severity: "blocker" },
    { headingKeywords: ["风险", "问题"], purpose: "主要风险", severity: "blocker" },
    { headingKeywords: ["建议", "修改", "调整"], purpose: "修改建议", severity: "blocker" },
    { headingKeywords: ["待确认", "待补充", "需确认"], purpose: "待确认事项", severity: "warning" },
  ],
  acceptanceCriteria: [
    "输出正式审查意见，而不是仅罗列检索点。",
    "至少包含审查结论、主要风险、修改建议和待确认事项。",
    "每条主要风险应附带条款引用或合同位置。",
  ],
  placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
  defaultClarificationQuestions: [],
};

const GENERAL_DOCUMENT_SPEC: DeliverableSpec = {
  type: "document.general",
  displayName: "通用法律文书",
  description: "通用法律文书草案，结构清晰、可直接编辑。",
  defaultTemplateId: "document-general-default",
  defaultOutput: "docx",
  defaultRiskLevel: "low",
  requiredSections: [
    { headingKeywords: ["概述", "背景", "事项"], purpose: "事项概述", severity: "warning" },
    { headingKeywords: ["分析", "意见", "说明"], purpose: "正文/分析", severity: "blocker" },
    { headingKeywords: ["结论", "建议", "下一步"], purpose: "结论与建议", severity: "warning" },
  ],
  acceptanceCriteria: [
    "优先输出可直接交付的正式正文。",
    "若信息不足，先给出可编辑正式草稿并明确待补充项。",
  ],
  placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
  defaultClarificationQuestions: [],
};

export const BUILT_IN_DELIVERABLE_SPECS: readonly DeliverableSpec[] = Object.freeze([
  RENTAL_CONTRACT_SPEC,
  GENERAL_CONTRACT_SPEC,
  DEMAND_LETTER_SPEC,
  CONTRACT_REVIEW_SPEC,
  GENERAL_DOCUMENT_SPEC,
]);

const SPEC_INDEX: Map<DeliverableType, DeliverableSpec> = new Map(
  BUILT_IN_DELIVERABLE_SPECS.map((spec) => [spec.type, spec]),
);

// 工作区级扩展规范（如事务所私有合同模板）。
// 进程内可变；engine bootstrap 通过 registerExtraDeliverableSpecs 写入，
// 测试用 clearExtraDeliverableSpecs 清空避免互相污染。
const EXTRA_SPEC_INDEX: Map<DeliverableType, DeliverableSpec> = new Map();

/**
 * 注册工作区/事务所级私有交付物规范。
 * 同 `type` 的扩展规范覆盖内置规范（允许事务所定制 `contract.general` 等）；
 * 全新 `type`（如 `contract.employment`）将作为新交付物类型暴露给 router/agent/desktop。
 */
export function registerExtraDeliverableSpecs(specs: readonly DeliverableSpec[]): void {
  for (const spec of specs) {
    EXTRA_SPEC_INDEX.set(spec.type, spec);
  }
}

/** 清空扩展规范（仅在测试 / engine 重启时使用）。 */
export function clearExtraDeliverableSpecs(): void {
  EXTRA_SPEC_INDEX.clear();
}

/** 当前注册的扩展规范快照，便于诊断、UI 展示。 */
export function listExtraDeliverableSpecs(): readonly DeliverableSpec[] {
  return Array.from(EXTRA_SPEC_INDEX.values());
}

/** 按 DeliverableType 查询交付物规范；扩展规范覆盖内置规范，未注册时返回 undefined。 */
export function getDeliverableSpec(type?: DeliverableType): DeliverableSpec | undefined {
  if (!type) {
    return undefined;
  }
  return EXTRA_SPEC_INDEX.get(type) ?? SPEC_INDEX.get(type);
}

/**
 * 列出所有可用规范（合并内置 + 扩展，扩展覆盖同 type 的内置）。
 * 顺序：先内置（保持稳定的展示顺序），再追加扩展中的新增 type。
 */
export function listDeliverableSpecs(): readonly DeliverableSpec[] {
  if (EXTRA_SPEC_INDEX.size === 0) {
    return BUILT_IN_DELIVERABLE_SPECS;
  }
  const merged: DeliverableSpec[] = BUILT_IN_DELIVERABLE_SPECS.map(
    (spec) => EXTRA_SPEC_INDEX.get(spec.type) ?? spec,
  );
  for (const extra of EXTRA_SPEC_INDEX.values()) {
    if (!BUILT_IN_DELIVERABLE_SPECS.some((b) => b.type === extra.type)) {
      merged.push(extra);
    }
  }
  return merged;
}
