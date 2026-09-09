/**
 * 基于结构化条款的结构化 lint 检查器。
 * 与既有 lint 规则独立；当 runLegalLint 传入 clausePatterns 时，可选合并。
 */

import type { ClauseDoc, ClauseType, SourceRange } from "./ast.js";
import { extractClauses } from "./extract.js";
import type { ClausePattern } from "./pattern.js";

export type ClauseFindingLevel = "blocker" | "warning" | "info";

export interface ClauseFinding {
  ruleId: string;
  family: "clause";
  level: ClauseFindingLevel;
  message: string;
  clauseType?: ClauseType;
  sourceRange?: SourceRange;
  anchor?: string;
}

function undefinedReferenceFindings(doc: ClauseDoc): ClauseFinding[] {
  const findings: ClauseFinding[] = [];
  const definedArticleNos = new Set(
    doc.clauses.map((c) => c.articleNo).filter((n): n is number => n !== undefined),
  );

  for (const ref of doc.references) {
    if (ref.kind === "article") {
      const n = Number.parseInt(ref.target, 10);
      if (Number.isFinite(n) && !definedArticleNos.has(n)) {
        findings.push({
          ruleId: "clause.undefined_article_ref",
          family: "clause",
          level: "warning",
          message: `交叉引用可能悬空：第 ${n} 条未见正文。`,
          clauseType: doc.clauses.find((c) => c.id === ref.clauseId)?.type,
          sourceRange: ref.sourceRange,
          anchor: ref.text,
        });
      }
    } else if (ref.kind === "previous") {
      if (ref.target === "previous") {
        findings.push({
          ruleId: "clause.previous_ref_unresolved",
          family: "clause",
          level: "warning",
          message: `「${ref.text}」无法解析到前一条款（当前为首个条款）。`,
          clauseType: doc.clauses.find((c) => c.id === ref.clauseId)?.type,
          sourceRange: ref.sourceRange,
          anchor: ref.text,
        });
      }
    }
  }

  // 被引用但未定义的术语：引号术语在正文中出现但未被定义
  const allDefinedTerms = new Set(doc.definitions.keys());
  const quotedTermRe = /[「“"]([^」”"]{1,30})[」”"]/g;
  for (const clause of doc.clauses) {
    if (!clause.body) {
      continue;
    }
    for (const m of clause.body.matchAll(quotedTermRe)) {
      const term = (m[1] ?? "").trim();
      if (!term || allDefinedTerms.has(term) || clause.definitionKeys?.includes(term)) {
        continue;
      }
      findings.push({
        ruleId: "clause.undefined_term",
        family: "clause",
        level: "warning",
        message: `术语「${term}」被引用但未定义。`,
        clauseType: clause.type,
        sourceRange: {
          startLine: clause.sourceRange.startLine,
          endLine: clause.sourceRange.endLine,
          startChar: clause.sourceRange.startChar + (m.index ?? 0),
          endChar: clause.sourceRange.startChar + (m.index ?? 0) + (m[0]?.length ?? 0),
        },
        anchor: term,
      });
    }
  }

  return findings;
}

function obligationLiabilityPairing(doc: ClauseDoc): ClauseFinding[] {
  const hasObligation = doc.clauses.some((c) => c.type === "obligation");
  const hasLiability = doc.clauses.some((c) => c.type === "liability");
  if (hasObligation && !hasLiability) {
    return [
      {
        ruleId: "clause.obligation_without_liability",
        family: "clause",
        level: "info",
        message: "合同存在义务条款但未识别到违约责任/赔偿条款，建议检查是否需补充。",
        clauseType: "obligation",
      },
    ];
  }
  return [];
}

function disputePresence(doc: ClauseDoc): ClauseFinding[] {
  const hasDispute = doc.clauses.some((c) => c.type === "dispute");
  if (!hasDispute) {
    return [
      {
        ruleId: "clause.dispute_missing",
        family: "clause",
        level: "warning",
        message: "未识别到争议解决条款。",
      },
    ];
  }
  return [];
}

/** 对合同文本执行结构化条款检查。 */
export function runClauseLint(docText: string, patterns?: ClausePattern[]): ClauseFinding[] {
  try {
    const doc = extractClauses(docText, patterns);
    return [
      ...undefinedReferenceFindings(doc),
      ...obligationLiabilityPairing(doc),
      ...disputePresence(doc),
    ];
  } catch {
    // 提取器崩溃不应破坏 lint 流程；返回空结果，避免误报。
    return [];
  }
}

/** 将 ClauseFinding 转换为 LegalLintFinding，用于合并到既有 lint 报告。 */
export function clauseFindingToLegalLint(finding: ClauseFinding) {
  return {
    ruleId: finding.ruleId,
    family: "clause" as const,
    severity: finding.level,
    message: finding.message,
    fixable: false,
    anchor: finding.anchor,
    statuteRef: undefined as string | undefined,
  };
}
