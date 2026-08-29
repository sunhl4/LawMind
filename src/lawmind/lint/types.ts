/**
 * Legal lint report — mechanical correctness signals (not legal judgment).
 * Passing lint ≠ legally correct; it means enumerated mechanical checks found no defect.
 */

export type LegalLintSeverity = "blocker" | "warning" | "info";

export type LegalLintFamily =
  | "consistency"
  | "statutory_cap"
  | "form"
  | "citation"
  | "placeholder"
  | "sale"
  | "loan";

export type LegalLintFinding = {
  ruleId: string;
  family: LegalLintFamily;
  severity: LegalLintSeverity;
  message: string;
  /** Optional clause / span hint for the lawyer. */
  anchor?: string;
  statuteRef?: string;
  fixable: boolean;
};

export type LegalLintReport = {
  schemaVersion: 1;
  checkedAt: string;
  /** Honest coverage statement shown to the lawyer. */
  coverageNote: string;
  ruleCount: number;
  findings: LegalLintFinding[];
  blockerCount: number;
  warningCount: number;
  summaryZh: string;
};

export type LegalLintRule = {
  id: string;
  family: LegalLintFamily;
  run: (text: string) => LegalLintFinding[];
};
