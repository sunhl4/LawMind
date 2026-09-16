/**
 * Independent legal Guardian (Codex-style).
 * Lawyer-facing types only — no Node I/O, safe for the desktop renderer.
 */

export const LEGAL_GUARDIAN_MAX_ROUNDS = 2;

export type GuardianVerdict = "pass" | "fail" | "skipped";

export type GuardianAction = "render_tracked_draft" | "render_document";

export type GuardianGap = {
  code: string;
  message: string;
  evidenceRef?: string;
};

/** Slim verdict shown to the lawyer / returned as a tool result. Never includes reviewer transcript. */
export type GuardianLawyerView = {
  verdict: GuardianVerdict;
  round: number;
  maxRounds: number;
  gaps: GuardianGap[];
  skipReason?: string;
};

export type GuardianHunkEvidence = {
  hunkId: string;
  heading?: string;
  before: string;
  after: string;
  anchor: string;
  rationale?: string;
};

export type GuardianSectionEvidence = {
  heading: string;
  body: string;
  citations: string[];
};

export type GuardianIssueEvidence = {
  issue: string;
  authorityIds: string[];
  openQuestions: string[];
};

export type GuardianCitationEvidence = {
  id: string;
  title?: string;
  citation?: string;
  usedInHeadings: string[];
};

export type GuardianChecklistItem = {
  id: string;
  look: string;
  edit?: string;
  stop: string;
};

export type GuardianGateFacts = {
  hunkGateOk?: boolean;
  hunkCount?: number;
  allowEmptyRedline?: boolean;
  citationIntegrityOk?: boolean;
  citationMissingIds?: string[];
  spanSkippedCount?: number;
  acceptanceReady?: boolean;
};

/**
 * Bounded evidence pack. Assembled by code, not by the writer.
 * Must not include writer self-scores (craft_check.coverage).
 */
export type GuardianEvidencePack = {
  action: GuardianAction;
  taskId: string;
  title: string;
  deliverableType?: string;
  confirmedAnswers: Array<{ key: string; value: string }>;
  hunks: GuardianHunkEvidence[];
  sections: GuardianSectionEvidence[];
  issues: GuardianIssueEvidence[];
  citations: GuardianCitationEvidence[];
  checklist: {
    family?: string;
    stance?: string;
    items: GuardianChecklistItem[];
  };
  gates: GuardianGateFacts;
  writerDeferredClaims: Array<{ issue?: string; reason?: string }>;
  prior: { round: number; verdict: GuardianVerdict; gaps: GuardianGap[] } | null;
};

export type GuardianRecord = GuardianLawyerView & {
  taskId: string;
  at: string;
  /** Sidecar-only. Never copy into session history. */
  reviewerRaw?: string;
  /** SHA-256 of the evidence pack excluding `prior`. Used to skip duplicate reviewer calls. */
  evidencePackHash?: string;
};
