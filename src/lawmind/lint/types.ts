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
  | "loan"
  | "lease"
  | "employment"
  | "equity"
  | "construction"
  | "clause"
  | "meta";

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
  /** 执行失败被跳过的规则 id——非空即代表本次核对覆盖不完整。 */
  failedRules: string[];
  summaryZh: string;
};

/**
 * Lint 运行上下文：族规则必须同时满足关键词 + 适用交付物类型；
 * 缺省 deliverableType 时族规则不触发。
 */
export type LegalLintContext = {
  deliverableType?: string;
  /** 结构化条款模式；传入时 runLegalLint 会合并 clause lint 结果。 */
  clausePatterns?: import("../clause/pattern.js").ClausePattern[];
};

export type LegalLintRule = {
  id: string;
  family: LegalLintFamily;
  run: (text: string, ctx?: LegalLintContext) => LegalLintFinding[];
};
