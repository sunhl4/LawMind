/**
 * LawMind 核心数据结构
 *
 * 脊柱结构（第一期）：
 *   TaskIntent          — 任务路由层的输出，描述"要做什么"
 *   ResearchBundle      — 检索层的输出，描述"找到了什么"
 *   LegalReasoningGraph — 推理层的输出（2.0新增），描述"如何论证"
 *   ArtifactDraft       — 整理层的输出，描述"要交付什么"
 *
 * 2.0 新增结构：
 *   ReviewLabel         — 审核结构化标签（驱动质量学习飞轮）
 *   QualityRecord       — 任务级质量快照（用于评测和统计）
 *   BenchmarkTask       — 黄金评测任务定义
 *   BenchmarkResult     — 单次评测结果
 *
 * 设计约束：
 *   - 所有结论必须能回溯来源（sourceIds）
 *   - 风险标记不得遗漏，由系统层填写，模型层不得删除
 *   - 高风险任务必须经过人工审核才能进入渲染阶段
 *   - 审核行为必须产生学习信号，不能只是状态切换
 */

// ─────────────────────────────────────────────
// 1. TaskIntent — 任务路由层输出
// ─────────────────────────────────────────────

/** 任务类型枚举 */
export type TaskKind =
  | "research.general" // 通用信息检索整理
  | "research.legal" // 法律专项检索
  | "research.hybrid" // 通用 + 法律联合检索
  | "draft.word" // 生成 Word 文书
  | "draft.ppt" // 生成 PPT 汇报（第二阶段）
  | "summarize.case" // 案件摘要
  | "analyze.contract" // 合同审查
  | "agent.instruction" // Agent 对话单轮用户指令（非路由生成）
  | "unknown"; // 路由失败，需要人工介入

/** 文书风险等级 */
export type RiskLevel = "low" | "medium" | "high";

/** 任务意图 — 由 Instruction Router 生成 */
export type TaskIntent = {
  /** 唯一任务 ID（系统生成） */
  taskId: string;
  /** 任务类型 */
  kind: TaskKind;
  /** 最终交付物格式 */
  output: "markdown" | "docx" | "pptx" | "none";
  /** 任务摘要，用于向律师展示"我将做什么" */
  summary: string;
  /** 目标受众（律师内部 / 客户 / 对方律师 / 法院） */
  audience?: string;
  /** 关联案件 ID（可选，第二阶段启用） */
  matterId?: string;
  /** 使用的模板 ID（对应 templates/ 下的文件） */
  templateId?: string;
  /** 风险等级（影响是否必须人工确认） */
  riskLevel: RiskLevel;
  /** 需要的模型类型 */
  models: Array<"general" | "legal">;
  /** 是否需要人工确认后才能执行 */
  requiresConfirmation: boolean;
  /** 任务创建时间 */
  createdAt: string;
};

// ─────────────────────────────────────────────
// 2. ResearchBundle — 检索层输出
// ─────────────────────────────────────────────

/** 来源类型 */
export type SourceKind =
  | "statute" // 法律法规正文
  | "regulation" // 司法解释 / 行政法规
  | "case" // 类案裁判
  | "memo" // 律师备忘录 / 工作文件
  | "contract" // 合同原文
  | "web" // 网络资料
  | "workspace" // 工作区文件
  | "unknown";

/** 单条来源 */
export type ResearchSource = {
  id: string;
  title: string;
  kind: SourceKind;
  /** 引用格式字符串，例如《XX法》第XX条 */
  citation?: string;
  /** 来源 URL 或文件路径 */
  url?: string;
  /** 法条/裁判日期 */
  date?: string;
  /** 裁判机构（类案时填写） */
  court?: string;
  /** 案号（类案时填写） */
  caseNumber?: string;
};

/** 单条结论 */
export type ResearchClaim = {
  text: string;
  /** 支撑该结论的来源 ID 列表 */
  sourceIds: string[];
  /** 置信度 0-1 */
  confidence: number;
  /** 标注来源模型 */
  model: "general" | "legal";
};

/** 检索层输出 — 所有结论必须有 sourceIds */
export type ResearchBundle = {
  taskId: string;
  query: string;
  sources: ResearchSource[];
  claims: ResearchClaim[];
  /** 发现的风险点，不得省略 */
  riskFlags: string[];
  /** 未找到足够依据的待确认事项 */
  missingItems: string[];
  /** 是否需要人工审核才能进入下一步 */
  requiresReview: boolean;
  completedAt: string;
};

// ─────────────────────────────────────────────
// 3. ArtifactDraft — 草稿层输出（交付前须审核）
// ─────────────────────────────────────────────

/** 文书章节 */
export type ArtifactSection = {
  heading: string;
  body: string;
  /** 该节引用的来源 ID */
  citations?: string[];
};

/** 审核状态 */
export type ReviewStatus = "pending" | "approved" | "rejected" | "modified";

/** 文书草稿 — 由推理层生成，渲染前须律师审核 */
export type ArtifactDraft = {
  taskId: string;
  /** 关联案件 ID（若存在） */
  matterId?: string;
  /** 文书标题 */
  title: string;
  /** 交付物格式 */
  output: "docx" | "pptx" | "markdown";
  /** 使用的模板 ID */
  templateId: string;
  /** 执行摘要（用于律师快速判断是否准确） */
  summary: string;
  /** 目标受众 */
  audience?: string;
  /** 正文章节列表 */
  sections: ArtifactSection[];
  /** 审阅备注，律师可在此写修改意见 */
  reviewNotes: string[];
  /** 审核状态 */
  reviewStatus: ReviewStatus;
  /** 审核人（由律师确认时填写） */
  reviewedBy?: string;
  /** 审核时间 */
  reviewedAt?: string;
  /** 最终产物路径（渲染完成后填写） */
  outputPath?: string;
  createdAt: string;
};

// ─────────────────────────────────────────────
// 4. TaskRecord — 持久化任务状态（便于断点续做）
// ─────────────────────────────────────────────

/** 任务生命周期状态 */
export type TaskLifecycleStatus =
  | "created"
  | "confirmed"
  | "researching"
  | "researched"
  | "drafted"
  | "reviewed"
  | "rejected"
  | "rendered"
  | "completed"; // Agent 对话回合等已结束（无引擎交付物）

/** 持久化任务记录 — 用于会话恢复、状态展示、审计串联 */
export type TaskRecord = {
  taskId: string;
  kind: TaskKind;
  summary: string;
  output: TaskIntent["output"];
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  audience?: string;
  matterId?: string;
  templateId?: string;
  title?: string;
  draftPath?: string;
  status: TaskLifecycleStatus;
  reviewStatus?: ReviewStatus;
  outputPath?: string;
  createdAt: string;
  updatedAt: string;
  /** 多助手：创建任务时的助手 ID（可选） */
  assistantId?: string;
  /** Agent 会话 ID（对话指令类任务） */
  sessionId?: string;
  /** 与 Agent turn 对齐的回合 ID（通常与 taskId 相同） */
  sourceTurnId?: string;
};

// ─────────────────────────────────────────────
// 5. MatterIndex — 案件级索引层（供工作台 / 审核台读取）
// ─────────────────────────────────────────────

export type MatterIndex = {
  matterId: string;
  caseFilePath: string;
  caseMemory: string;
  coreIssues: string[];
  taskGoals: string[];
  riskNotes: string[];
  progressEntries: string[];
  artifacts: string[];
  tasks: TaskRecord[];
  drafts: ArtifactDraft[];
  auditEvents: AuditEvent[];
  openTasks: TaskRecord[];
  renderedTasks: TaskRecord[];
  latestUpdatedAt?: string;
};

export type MatterOverview = {
  matterId: string;
  latestUpdatedAt?: string;
  openTaskCount: number;
  renderedTaskCount: number;
  riskCount: number;
  artifactCount: number;
  topIssue?: string;
  topRisk?: string;
};

export type MatterSummary = {
  headline: string;
  statusLine: string;
  keyRisks: string[];
  nextActions: string[];
  recentActivity: string[];
};

export type MatterSearchHit = {
  section:
    | "coreIssues"
    | "taskGoals"
    | "riskNotes"
    | "progressEntries"
    | "artifacts"
    | "tasks"
    | "drafts"
    | "auditEvents";
  text: string;
  taskId?: string;
};

// ─────────────────────────────────────────────
// 6. 审计事件 — 每个任务关键步骤都应生成一条
// ─────────────────────────────────────────────

export type AuditEventKind =
  | "task.created"
  | "task.confirmed"
  | "task.rejected"
  | "research.started"
  | "research.completed"
  | "draft.created"
  | "draft.citation_integrity"
  | "draft.reviewed"
  | "draft.review_labeled" // 2.0：审核附加结构化标签
  | "artifact.rendered"
  | "artifact.render_failed"
  | "artifact.sent"
  | "memory.profile_updated" // 2.0：律师/助手偏好写回
  | "memory.playbook_updated" // Phase D：条款 playbook 审核学习写回
  | "quality.benchmark_run" // 2.0：评测任务执行记录
  | "quality.snapshot" // Phase B：任务质量指标快照已写入
  | "golden.example_promoted" // Phase B：草稿晋升为黄金样本
  | "learning.suggestion_queued" // 2.0：审核学习先入队
  | "learning.suggestion_adopted" // 2.0：学习建议已采纳写回
  | "learning.suggestion_dismissed" // 2.0：学习建议已忽略
  | "ui.matter_action" // 2.0：桌面端案件工作台关键律师动作
  | "tool_call"
  | "agent_turn";

/** 审计事件 */
export type AuditEvent = {
  eventId: string;
  taskId: string;
  kind: AuditEventKind;
  actor: "system" | "lawyer" | "model";
  /** Optional operator identity, e.g. `lawyer:desktop` or `lawyer:<firm-id>` (see LAWMIND-ACTOR-ATTRIBUTION). */
  actorId?: string;
  detail?: string;
  timestamp: string;
};

// ─────────────────────────────────────────────
// 7. ReviewLabel — 审核结构化标签（质量学习飞轮）
// ─────────────────────────────────────────────

/**
 * 审核标签枚举。
 * 律师在审核草稿时可以附加一组标签，
 * 系统将这些标签写回律师/助手记忆文件，
 * 并用于计算质量指标。
 */
export type ReviewLabel =
  | "tone.too_strong" // 语气过强，建议保守表述
  | "tone.too_weak" // 语气过弱，可以更明确结论
  | "citation.incomplete" // 引用不足或无法回溯
  | "citation.incorrect" // 引用有误（法条号/案号错误）
  | "issue.missing" // 关键争点未覆盖
  | "issue.over_argued" // 次要争点占篇幅过多
  | "fact.ordering" // 事实叙述顺序需调整
  | "fact.inaccurate" // 事实描述不准确
  | "risk.calibration_high" // 风险等级标注偏高
  | "risk.calibration_low" // 风险等级标注偏低（最危险，要优先学习）
  | "risk.missing_flag" // 高风险点未被标出
  | "audience.wrong_framing" // 受众定位有误（客户稿与内部稿混淆）
  | "structure.template_mismatch" // 使用的模板不符合本类任务
  | "quality.good_example"; // 此草稿可作为黄金样本

/** 单条审核学习记录，附加到审核事件上 */
export type ReviewLearningRecord = {
  taskId: string;
  draftTitle: string;
  taskKind: TaskKind;
  templateId: string;
  labels: ReviewLabel[];
  /** 律师自由文本补充（可选），作为学习摘要追加到 PROFILE.md */
  learningNote?: string;
  reviewedBy?: string;
  reviewedAt: string;
};

// ─────────────────────────────────────────────
// 8. LegalReasoningGraph — 法律推理层（检索→起草之间的中间结构）
// ─────────────────────────────────────────────

/**
 * 法律推理图谱。
 * 捕获律师在起草文书前的推理结构：
 * 争点树 → 论证矩阵 → 权威冲突 → 交付风险。
 * 由 src/lawmind/reasoning/legal-graph.ts 构建。
 */
export type LegalIssueNode = {
  issue: string;
  /** IRAC 要件列表 */
  elements: string[];
  /** 相关事实（来自案件 CASE.md 或检索 bundle） */
  facts: string[];
  /** 支撑该争点的证据摘要 */
  evidence: string[];
  /** 适用法条与类案 ID（对应 ResearchSource.id） */
  authorityIds: string[];
  /** 尚待核实或确认的问题 */
  openQuestions: string[];
  /** 律师/系统对该争点结论的置信度 0-1 */
  confidence: number;
};

export type ArgumentPosition = {
  position: string;
  /** 支撑依据（来源 ID 列表） */
  supportIds: string[];
  /** 对方可能的抗辩 */
  likelyCounterarguments: string[];
  /** 我方反驳思路 */
  rebuttals: string[];
  /** 此论点是否有证据支撑（无支撑的应标记为"法律推理"） */
  evidenceBacked: boolean;
};

export type AuthorityConflict = {
  /** 互相冲突的来源 ID */
  authorityIds: string[];
  /** 冲突描述 */
  conflict: string;
  /** 建议的处理方式（如以新法优先、以特别法优先） */
  resolutionNote?: string;
  /** 是否已解决 */
  resolved: boolean;
};

export type LegalReasoningGraph = {
  taskId: string;
  matterId?: string;
  /** 争点树（每个节点是一个独立法律争点） */
  issueTree: LegalIssueNode[];
  /** 论证矩阵（我方主张与支撑） */
  argumentMatrix: ArgumentPosition[];
  /** 权威冲突列表（法条、类案、内部意见互相矛盾的情况） */
  authorityConflicts: AuthorityConflict[];
  /**
   * 交付风险标记（不同于检索风险，专指起草时应保守措辞的点）。
   * 如"该条款合法性存疑，建议表述为'可能'而非'明确'。"
   */
  deliveryRisks: string[];
  /** 整体推理置信度 0-1（各争点置信度的加权均值） */
  overallConfidence: number;
  builtAt: string;
};

// ─────────────────────────────────────────────
// 9. QualityRecord — 任务级质量快照（评测与统计用）
// ─────────────────────────────────────────────

/**
 * 单任务质量指标快照。
 * 由引擎在 render 完成或审核事件后计算并持久化。
 * 用于构建律所/律师级质量报告和基准测试基线。
 */
export type QualityRecord = {
  taskId: string;
  taskKind: TaskKind;
  templateId?: string;
  assistantId?: string;
  matterId?: string;
  /** 引用有效率 = 有效引用数 / 草稿总引用数，无引用时为 null */
  citationValidityRate: number | null;
  /** 争点覆盖率 = 草稿覆盖的争点数 / 推理图谱总争点数，无推理图时为 null */
  issueCoverageRate: number | null;
  /** 风险召回率 = 草稿中标出的风险数 / bundle.riskFlags.length，无 riskFlags 时为 null */
  riskRecallRate: number | null;
  /** 一次性通过（律师未做实质性修改即批准）*/
  firstPassApproved: boolean;
  /** 审核状态 */
  reviewStatus: ReviewStatus;
  /** 律师附加的结构化标签 */
  reviewLabels: ReviewLabel[];
  /** 是否可作为黄金样本 */
  isGoldenExample: boolean;
  /** 从指令到初稿的毫秒数 */
  latencyMs?: number;
  /** Phase B：创建任务时助手岗位 preset id（若有） */
  presetKey?: string;
  createdAt: string;
};

// ─────────────────────────────────────────────
// 10. BenchmarkTask / BenchmarkResult — 评测体系
// ─────────────────────────────────────────────

/**
 * 评测任务定义。
 * 每条代表一个已知"黄金指令"及其期望产出特征，
 * 用于回归测试和发布质量门控。
 */
export type BenchmarkTask = {
  benchmarkId: string;
  /** 评测场景分类 */
  category:
    | "contract_review"
    | "legal_memo"
    | "demand_letter"
    | "litigation_outline"
    | "client_brief"
    | "due_diligence"
    | "compliance_review"
    | "matter_update_ppt";
  /** 给引擎的输入指令（模拟律师下达） */
  instruction: string;
  /** 期望的任务类型 */
  expectedKind: TaskKind;
  /** 期望的交付格式 */
  expectedOutput: TaskIntent["output"];
  /** 期望输出至少覆盖的关键词 / 概念（用于简单验收） */
  expectedKeywords: string[];
  /** 期望风险等级（low/medium/high） */
  expectedRiskLevel: RiskLevel;
  /** 是否应触发人工审核门 */
  expectsReviewGate: boolean;
  /** 说明 / 备注 */
  description?: string;
};

/** 单次评测结果 */
export type BenchmarkResult = {
  benchmarkId: string;
  runId: string;
  /** 评测时间戳 */
  ranAt: string;
  /** 使用的模型标识 */
  modelHint?: string;
  /** 任务是否成功完成（无崩溃、有输出） */
  taskCompleted: boolean;
  /** 实际产生的任务类型是否与期望一致 */
  kindMatched: boolean;
  /** 期望关键词命中率 0-1 */
  keywordHitRate: number;
  /** 风险等级是否与期望一致 */
  riskLevelMatched: boolean;
  /** 是否触发了审核门（与期望一致 = pass） */
  reviewGateMatched: boolean;
  /** 生成草稿的来源数（可用于评估检索质量） */
  sourceCount: number;
  /** 生成草稿的结论数 */
  claimCount: number;
  /** 从指令到初稿的毫秒数 */
  latencyMs: number;
  /** 综合评分 0-1（由各子指标加权得出） */
  score: number;
  /** 失败原因（若 taskCompleted = false） */
  errorMessage?: string;
};
