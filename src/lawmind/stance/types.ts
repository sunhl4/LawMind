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

export type StanceSource = "redline" | "habit_adopt" | "manual";

export type StanceItem = {
  id: string;
  clauseType: string;
  family?: string;
  position: string;
  preferredLanguage: string;
  rationale?: string;
  statuteBasis?: string;
  source: StanceSource;
  confidence: number;
  occurrences: number;
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
