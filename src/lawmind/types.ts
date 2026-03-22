/**
 * LawMind 核心数据结构
 *
 * 三个结构是第一期系统的脊柱：
 *   TaskIntent       — 任务路由层的输出，描述"要做什么"
 *   ResearchBundle   — 检索层的输出，描述"找到了什么"
 *   ArtifactDraft    — 推理/整理层的输出，描述"要交付什么"
 *
 * 设计约束：
 *   - 所有结论必须能回溯来源（sourceIds）
 *   - 风险标记不得遗漏，由系统层填写，模型层不得删除
 *   - 高风险任务必须经过人工审核才能进入渲染阶段
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
  | "draft.reviewed"
  | "artifact.rendered"
  | "artifact.sent"
  | "tool_call"
  | "agent_turn";

/** 审计事件 */
export type AuditEvent = {
  eventId: string;
  taskId: string;
  kind: AuditEventKind;
  actor: "system" | "lawyer" | "model";
  actorId?: string;
  detail?: string;
  timestamp: string;
};
