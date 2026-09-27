/**
 * Independent legal Guardian (Codex-style).
 * Lawyer-facing types only — no Node I/O, safe for the desktop renderer.
 */

import type { JudgmentTier } from "./judgment-tier.js";

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
  /** 全文指纹。正文截断后仍能让证据包哈希跟着改稿变，避免沿用过期的 fail。 */
  bodyFingerprint: string;
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
  /**
   * 规范依据（来源清单的「透」栏）。
   *
   * G0 修复：`WordRevisionChecklistItem.lens` 此前在 `guardian/run.ts` 构造检查项时被
   * **丢弃**，导致模型判「诚信」类项时看不到该项对应的法条，判据被削弱。现在带上。
   */
  lens?: string;
  /**
   * 判定主体（G0）。缺省即按 `judge` 处理——保守方向，由 `resolveJudgmentTier` 兜底。
   */
  tier?: JudgmentTier;
};

/** 判定主体（与 `judgment-tier.ts` 同源，此处只做类型转发，避免重复定义）。 */
export type { JudgmentTier } from "./judgment-tier.js";

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
  /**
   * G3：本次被移出提示词、需律师定夺的主观项（`tier: "lawyer"`）。
   *
   * **进程律师可见面时只用 `label` / `reason`**——`itemKey` 是内部 id，不得进 UI 文案
   * （见 `ui-copy-lint` 禁词表）。
   *
   * 只有升级通道可用时才会有内容；通道不可用时主观项仍由模型判（见
   * `policy/judgment-tiering.ts` 的 `isLawyerEscalationAvailable`）。
   */
  escalationItems?: Array<{ itemKey: string; label: string; reason: string }>;
};
