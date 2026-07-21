/** Skills E5 — Matter Ops (scope / plan / RAID). */

export type MatterOpsScope = {
  matterId: string;
  baseline: string;
  updatedAt: string;
  changes?: Array<{ at: string; note: string }>;
};

export type MatterOpsPlanPhase = {
  id: string;
  title: string;
  owner?: string;
  dueAt?: string;
};

export type MatterOpsPlan = {
  matterId: string;
  phases: MatterOpsPlanPhase[];
  milestones: Array<{ id: string; title: string; dueAt?: string }>;
  updatedAt: string;
};

export type MatterRaidKind = "risk" | "assumption" | "issue" | "decision";

export type MatterRaidEntry = {
  id: string;
  kind: MatterRaidKind;
  text: string;
  status?: "open" | "closed";
  createdAt: string;
};

export type MatterOpsSummary = {
  matterId: string;
  scope: MatterOpsScope | null;
  plan: MatterOpsPlan | null;
  raidRecent: MatterRaidEntry[];
  openRiskCount: number;
  nextMilestone: { id: string; title: string; dueAt?: string } | null;
};

/** Solo light theory (3 blocks) — matter-scoped. */
export type MatterTheoryLite = {
  matterId: string;
  issues: string;
  authorities: string;
  openQuestions: string;
  updatedAt: string;
  /** When set, used as reasoning anchor for high-risk drafts */
  anchored: boolean;
};
