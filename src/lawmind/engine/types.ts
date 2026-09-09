/**
 * Engine 公共类型 — 与 `src/lawmind/index.ts` 历史导出形状保持一致。
 */

import type { RetrievalAdapter } from "../retrieval/index.js";
import type { RouteInput } from "../router/index.js";
import type {
  ArtifactDraft,
  MatterIndex,
  MatterOverview,
  MatterSearchHit,
  MatterSummary,
  QualityRecord,
  ResearchBundle,
  ReviewLabel,
  ReviewStatus,
  TaskIntent,
  TaskRecord,
} from "../types.js";

export type LawMindEngineConfig = {
  /** 工作区根目录，内含 MEMORY.md / LAWYER_PROFILE.md / memory/ */
  workspaceDir: string;
  /** 最终产物输出目录（默认 workspaceDir/artifacts） */
  outputDir?: string;
  /** 检索适配器列表，按优先级排序 */
  adapters: RetrievalAdapter[];
  /** 多助手：写入任务记录归因 */
  assistantId?: string;
};

export type LawMindEngine = {
  /** 步骤 1：解析指令，生成任务意图（供律师确认） */
  plan: (instruction: string, opts?: Omit<RouteInput, "instruction">) => TaskIntent;
  /** 步骤 1（异步）：有凭据时模型路由，否则关键词回退 */
  planAsync: (instruction: string, opts?: Omit<RouteInput, "instruction">) => Promise<TaskIntent>;
  /** 步骤 1.5：律师确认任务后才允许进入高风险检索 */
  confirm: (taskId: string, opts?: { actorId?: string; note?: string }) => Promise<TaskRecord>;
  /** 步骤 2：执行检索（律师确认后调用） */
  research: (intent: TaskIntent, opts?: { signal?: AbortSignal }) => Promise<ResearchBundle>;
  /** 步骤 3：生成草稿（供律师审核） */
  draft: (
    intent: TaskIntent,
    bundle: ResearchBundle,
    opts?: { title?: string; templateId?: string },
  ) => ArtifactDraft;
  /** 步骤 3（异步）：可选模型推理（LAWMIND_REASONING_MODE=model） */
  draftAsync: (
    intent: TaskIntent,
    bundle: ResearchBundle,
    opts?: {
      title?: string;
      templateId?: string;
      /** Populated with draft sub-phase wall times (ms) when set. */
      phaseTiming?: Record<string, number>;
    },
  ) => Promise<ArtifactDraft>;
  /**
   * 步骤 4：记录律师审核结果并写入任务状态。
   * 若提供 `labels`，则按需写回学习记录或入队。
   */
  review: (
    draft: ArtifactDraft,
    opts?: {
      actorId?: string;
      status?: Exclude<ReviewStatus, "pending">;
      note?: string;
      /** 结构化审核标签，驱动质量学习飞轮 */
      labels?: ReviewLabel[];
      /** 为 true 时标签只入学习队列，不立即写回 PROFILE / Playbook */
      deferMemoryWrites?: boolean;
      /** 桌面审核台传入时用于助手 PROFILE 写回；覆盖引擎 config.assistantId */
      assistantId?: string;
    },
  ) => Promise<ArtifactDraft>;
  /** 将非「待审核」的草稿恢复为待审核 */
  reopenDraftReview: (
    taskId: string,
    opts?: { actorId?: string },
  ) => Promise<ArtifactDraft | undefined>;
  /** 步骤 4b：计算并持久化当前任务的质量快照 */
  recordQuality: (
    taskId: string,
    opts?: { labels?: ReviewLabel[]; latencyMs?: number },
  ) => Promise<QualityRecord | undefined>;
  /** 步骤 5：渲染文书（rejected 拒绝；pending/modified 可本地出稿） */
  render: (
    draft: ArtifactDraft,
    opts?: {
      templateIdOverride?: string;
      strictGates?: boolean;
      citationGateStrict?: boolean;
      includeProvenance?: boolean;
    },
  ) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  /** 读取持久化任务状态 */
  getTaskState: (taskId: string) => TaskRecord | undefined;
  /** 读取持久化草稿 */
  getDraft: (taskId: string) => ArtifactDraft | undefined;
  /** 聚合读取案件索引 */
  getMatterIndex: (matterId: string) => Promise<MatterIndex>;
  /** 读取案件总览列表 */
  listMatterOverviews: () => Promise<MatterOverview[]>;
  /** 读取案件摘要 */
  getMatterSummary: (matterId: string) => Promise<MatterSummary>;
  /** 在案件内搜索 */
  searchMatter: (matterId: string, query: string) => Promise<MatterSearchHit[]>;
};
