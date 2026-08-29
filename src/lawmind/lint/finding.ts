import type { LegalLintFinding, LegalLintRule } from "./types.js";

export function lintFinding(
  rule: Pick<LegalLintRule, "id" | "family">,
  severity: LegalLintFinding["severity"],
  message: string,
  extra?: Partial<LegalLintFinding>,
): LegalLintFinding {
  return {
    ruleId: rule.id,
    family: rule.family,
    severity,
    message,
    fixable: extra?.fixable ?? false,
    anchor: extra?.anchor,
    statuteRef: extra?.statuteRef,
  };
}
