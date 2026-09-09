import { defaultClausePatterns } from "../clause/dsl.js";
import { clauseFindingToLegalLint, runClauseLint } from "../clause/lint.js";
import {
  CITATION_VALIDITY_RULE_COUNT,
  lintCitationValidity,
  type LegalLintCitationHit,
} from "./citation-validity.js";
import { familyDeliverableMatches } from "./family-gate.js";
import { LEGAL_LINT_RULES } from "./rules.js";
import { STATUTE_PARAMS_VERSION } from "./statute-params.js";
import type {
  LegalLintContext,
  LegalLintFamily,
  LegalLintFinding,
  LegalLintReport,
  LegalLintRule,
} from "./types.js";

const CONTRACT_FAMILY = new Set<LegalLintFamily>([
  "sale",
  "loan",
  "lease",
  "employment",
  "equity",
  "construction",
]);

function ruleAppliesToContext(rule: LegalLintRule, ctx?: LegalLintContext): boolean {
  if (!CONTRACT_FAMILY.has(rule.family)) {
    return true;
  }
  return familyDeliverableMatches(rule.family, ctx);
}

function resolveClausePatterns(ctx?: LegalLintContext) {
  if (ctx?.clausePatterns && ctx.clausePatterns.length > 0) {
    return ctx.clausePatterns;
  }
  if (ctx?.deliverableType?.startsWith("contract.")) {
    return defaultClausePatterns();
  }
  return undefined;
}

export type { LegalLintCitationHit };

export function runLegalLint(
  text: string,
  citationHits?: LegalLintCitationHit[] | Date,
  now = new Date(),
  extraRules: LegalLintRule[] = [],
  context?: LegalLintContext,
): LegalLintReport {
  const hits = Array.isArray(citationHits) ? citationHits : undefined;
  const checkedAt = citationHits instanceof Date ? citationHits : now;
  const body = text ?? "";
  const rules = extraRules.length > 0 ? [...LEGAL_LINT_RULES, ...extraRules] : LEGAL_LINT_RULES;
  const applicableRules = rules.filter((rule) => ruleAppliesToContext(rule, context));
  const failedRules: string[] = [];
  const findings: LegalLintFinding[] = [
    ...applicableRules.flatMap((rule) => {
      try {
        return rule.run(body, context);
      } catch {
        // 规则崩溃不得静默缺席：记入 failedRules 并产出 ruleError finding。
        failedRules.push(rule.id);
        return [];
      }
    }),
    ...lintCitationValidity(body, hits),
  ];

  const clausePatterns = resolveClausePatterns(context);
  if (clausePatterns && clausePatterns.length > 0) {
    findings.push(...runClauseLint(body, clausePatterns).map(clauseFindingToLegalLint));
  }
  for (const ruleId of failedRules) {
    findings.push({
      ruleId: "meta.rule_error",
      family: "meta",
      severity: "warning",
      message: `规则 ${ruleId} 执行失败已跳过，本项核对缺失。`,
      fixable: false,
    });
  }
  const blockerCount = findings.filter((f) => f.severity === "blocker").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const ruleCount = rules.length + CITATION_VALIDITY_RULE_COUNT;
  const applicableCount = applicableRules.length + CITATION_VALIDITY_RULE_COUNT;
  const failureNote =
    failedRules.length > 0
      ? `注意：${failedRules.length} 条规则执行失败（见 failedRules），核对覆盖不完整。`
      : "";
  const coverageNote = `运行 ${ruleCount} 条规则，本次适用 ${applicableCount} 条（参数库 v${STATUTE_PARAMS_VERSION}）。${failureNote}通过 ≠ 法律正确，只表示已知机械缺陷未漏网。`;
  const summaryZh =
    blockerCount > 0
      ? `机械核对发现 ${blockerCount} 项必须处理、${warningCount} 项提示。${coverageNote}`
      : warningCount > 0
        ? `机械核对无硬伤，${warningCount} 项提示。${coverageNote}`
        : `机械核对未见已知缺陷。${coverageNote}`;
  return {
    schemaVersion: 1,
    checkedAt: checkedAt.toISOString(),
    coverageNote,
    ruleCount,
    findings,
    blockerCount,
    warningCount,
    failedRules,
    summaryZh,
  };
}

export function draftTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const rec = value as Record<string, unknown>;
  const draft =
    rec.draft && typeof rec.draft === "object" && !Array.isArray(rec.draft)
      ? (rec.draft as Record<string, unknown>)
      : rec;
  const parts: string[] = [];
  if (typeof draft.title === "string") {
    parts.push(draft.title);
  }
  if (typeof draft.summary === "string") {
    parts.push(draft.summary);
  }
  if (Array.isArray(draft.sections)) {
    for (const section of draft.sections) {
      if (!section || typeof section !== "object") {
        continue;
      }
      const row = section as Record<string, unknown>;
      if (typeof row.heading === "string") {
        parts.push(row.heading);
      }
      if (typeof row.body === "string") {
        parts.push(row.body);
      }
    }
  }
  return parts.join("\n");
}
