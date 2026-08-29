/**
 * Triage session — Skills epic E1.
 * GREEN / YELLOW / RED before heavy execute.
 */

export type TriageTier = "green" | "yellow" | "red";

export type TriageClarificationItem = {
  key: string;
  question: string;
  required: boolean;
  answer?: string;
};

export type TriageResult = {
  tier: TriageTier;
  /** Lawyer-facing Chinese label */
  tierLabel: string;
  reasons: string[];
  recommendedWorkflowId: string;
  recommendedWorkflowLabel: string;
  estimatedEffort: "low" | "medium" | "high";
  clarifications: TriageClarificationItem[];
  /** Rule id that fired (for audit / tests) */
  matchedRuleIds: string[];
};

export type TriageSessionStatus = "preview" | "confirmed" | "saved_only" | "cancelled";

export type TriageSession = {
  id: string;
  matterId: string | null;
  createdAt: string;
  updatedAt: string;
  status: TriageSessionStatus;
  inputSummary: string;
  deliverableTypeHint?: string;
  result: TriageResult;
  confirmedAt?: string;
  /** Prompt to dispatch after confirm */
  dispatchPrompt?: string;
};

export type TriagePreviewInput = {
  matterId?: string | null;
  text: string;
  deliverableTypeHint?: string;
  /** Solo preference: auto-confirm green without UI step */
  skipGreenConfirm?: boolean;
};
