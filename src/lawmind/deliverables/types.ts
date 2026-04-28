/**
 * Deliverable spec & acceptance gate types.
 *
 * 设计目标：把"做事"重构为"交付成品"。
 *
 * 一个 DeliverableSpec 描述某种交付物（合同、律师函、审查意见等）的：
 *   - 必要章节（required sections / clauses）
 *   - 验收清单（acceptance criteria）
 *   - 占位符规则（placeholder discipline）
 *   - 推荐模板与默认风险等级
 *
 * 这是 Deliverable-First Architecture 的一等公民，与
 * `router/deliverable-meta.ts` 互补：
 *   - deliverable-meta：在 Router 阶段附加 questions / criteria（轻量、运行期）
 *   - deliverables/spec：在 Draft / Render 阶段做结构验收（强约束、可测试）
 */

import type { ArtifactDraft, ClarificationQuestion, DeliverableType, RiskLevel } from "../types.js";

/** 单条必要章节定义 */
export type RequiredSection = {
  /** 用于在草稿章节标题中匹配的关键词（任一命中即视为存在） */
  headingKeywords: string[];
  /** 章节用途说明（用于错误报告与 LLM prompt） */
  purpose: string;
  /** 该章节缺失时的严重等级，决定是否阻断渲染 */
  severity: "blocker" | "warning";
};

/** 占位符规则：用于显式标识「待补充」内容 */
export type PlaceholderRule = {
  /** 推荐占位符正则（默认 /【待补充[:：][^】]*】/） */
  pattern?: RegExp;
  /** 渲染前是否要求清空（true：必须无占位符；false：允许带占位符发布） */
  mustResolveBeforeRender: boolean;
};

/** 交付物规范 */
export type DeliverableSpec = {
  /** 交付物类型（与 TaskIntent.deliverableType 对齐） */
  type: DeliverableType;
  /** 律师可读的中文名 */
  displayName: string;
  /** 一句话描述这份交付物长什么样 */
  description: string;
  /** 推荐使用的模板 ID（templates/<id>.md） */
  defaultTemplateId: string;
  /** 默认输出格式 */
  defaultOutput: "docx" | "pptx" | "markdown";
  /** 该类交付物的默认风险等级 */
  defaultRiskLevel: RiskLevel;
  /** 必要章节（按律师工作惯例） */
  requiredSections: RequiredSection[];
  /** 验收标准（律师"我敢交"的清单） */
  acceptanceCriteria: string[];
  /** 占位符规则 */
  placeholderRule: PlaceholderRule;
  /** 默认补充信息问题（信息不足时统一从这里取） */
  defaultClarificationQuestions: ClarificationQuestion[];
};

/** 单项验收检查结果 */
export type AcceptanceCheck = {
  /** 检查项标识（用于稳定回归） */
  key: string;
  /** 律师可读描述 */
  label: string;
  /** 是否通过 */
  passed: boolean;
  /** 严重等级（blocker 不通过则不允许渲染） */
  severity: "blocker" | "warning";
  /** 失败时的可读建议（通过时为空） */
  hint?: string;
};

/** 验收报告（Acceptance Gate 的核心输出） */
export type AcceptanceReport = {
  /** 草稿 ID */
  taskId: string;
  /** 交付物类型 */
  deliverableType?: DeliverableType;
  /** 整体是否可交付（所有 blocker 都通过即为 true） */
  ready: boolean;
  /** 单项检查清单 */
  checks: AcceptanceCheck[];
  /** 阻断项数量 */
  blockerCount: number;
  /** 提示项数量 */
  warningCount: number;
  /** 检测到的占位符数量（来自 sections 与 reviewNotes） */
  placeholderCount: number;
  /** 检测到的占位符样例（最多 5 条，便于桌面 UI 显示） */
  placeholderSamples: string[];
  /** 报告生成时间 */
  generatedAt: string;
};

/** 验证选项 */
export type ValidateDraftOptions = {
  /** 显式指定 spec（不传时按 draft.deliverableType 查询 registry） */
  spec?: DeliverableSpec;
  /** 是否要求所有 acceptanceCriteria 都被对应章节覆盖（默认 true） */
  requireCriteriaCoverage?: boolean;
};

export type ValidateDraftFn = (
  draft: ArtifactDraft,
  opts?: ValidateDraftOptions,
) => AcceptanceReport;
