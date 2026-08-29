import {
  CITATION_VALIDITY_RULE_COUNT,
  lintCitationValidity,
  type LegalLintCitationHit,
} from "./citation-validity.js";
import { LEGAL_LINT_RULES } from "./rules.js";
import { STATUTE_PARAMS_VERSION } from "./statute-params.js";
import type { LegalLintReport } from "./types.js";

export type { LegalLintCitationHit };

export function runLegalLint(
  text: string,
  citationHits?: LegalLintCitationHit[] | Date,
  now = new Date(),
): LegalLintReport {
  const hits = Array.isArray(citationHits) ? citationHits : undefined;
  const checkedAt = citationHits instanceof Date ? citationHits : now;
  const body = text ?? "";
  const findings = [
    ...LEGAL_LINT_RULES.flatMap((rule) => {
      try {
        return rule.run(body);
      } catch {
        return [];
      }
    }),
    ...lintCitationValidity(body, hits),
  ];
  const blockerCount = findings.filter((f) => f.severity === "blocker").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const ruleCount = LEGAL_LINT_RULES.length + CITATION_VALIDITY_RULE_COUNT;
  const coverageNote = `本次机械核对 ${ruleCount} 项（参数库 v${STATUTE_PARAMS_VERSION}）。通过 ≠ 法律正确，只表示已知机械缺陷未漏网。`;
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
