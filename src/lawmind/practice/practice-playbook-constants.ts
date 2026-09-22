/**
 * Browser-safe practice-playbook constants (no node:fs / node:path).
 * Disk I/O stays in practice-playbook.ts for engine / local API.
 */

export const PRACTICE_STANCE_DEFAULTS = ["protect_instructing", "our_paper", "neutral"] as const;

export type PracticeStanceDefault = (typeof PRACTICE_STANCE_DEFAULTS)[number];

export const PRACTICE_STANCE_LABELS: Record<PracticeStanceDefault, string> = {
  protect_instructing: "中立偏委托方（开箱默认）",
  our_paper: "偏己方纸",
  neutral: "中立",
};
