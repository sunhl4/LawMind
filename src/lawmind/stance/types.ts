/** Structured lawyer clause stance (workspace/lawmind/stance/items.json). */

export const STANCE_SCHEMA_VERSION = 1 as const;

export const STANCE_CLAUSE_TYPE_IDS = [
  "管辖",
  "违约金",
  "保密",
  "赔偿",
  "定金",
  "知识产权",
  "其他",
] as const;

export type StanceClauseTypeId = (typeof STANCE_CLAUSE_TYPE_IDS)[number];

export type StanceFamily = "sale" | "loan" | "general";

export type StanceSource = "redline" | "habit_adopt" | "manual" | "revision_pack";

/**
 * 证据条目：一次来源观察（红线接受 / 修订包要点 / 习惯采纳）。
 * matterId 用于跨案件注入门槛与注入前客户冲突检查；缺省表示来源案件不可考。
 */
export type StanceEvidenceEntry = {
  source: StanceSource;
  at: string;
  matterId?: string;
};

export type StanceItem = {
  id: string;
  clauseType: string;
  family?: string;
  position: string;
  preferredLanguage: string;
  rationale?: string;
  statuteBasis?: string;
  source: StanceSource;
  /** 由 evidence 按来源权重派生；无账本的存量条目保留写入时的值。 */
  confidence: number;
  occurrences: number;
  evidence?: StanceEvidenceEntry[];
  createdAt: string;
  updatedAt: string;
  supersededBy?: string;
};

export type StanceStoreFile = {
  schemaVersion: typeof STANCE_SCHEMA_VERSION;
  items: StanceItem[];
};

export type StanceRedlineHunk = {
  before: string;
  after: string;
  heading?: string;
  status: string;
};
