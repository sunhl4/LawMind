/**
 * Fixture integrity checks.
 *
 * These catch the defects that the 2026-10-22 measurement round only found by
 * reading the model's rationale after the fact. A fixture that cannot be
 * answered unambiguously is not a test — it is a source of unexplained
 * mismatches. `--validate` runs these before any model call.
 *
 * Deliberately conservative: every check reports a concrete sentence or id, so
 * the failure message says what to fix rather than "invalid fixture".
 */

import type { ReviewRule } from "../review/rules.js";
import type { RuleAllPassCase } from "./rule-allpass.js";

export type IntegrityFinding = {
  caseId: string;
  /** Stable code so CI output can be grepped. */
  code: IntegrityCode;
  problem: string;
};

export type IntegrityCode =
  | "dangling_attachment"
  | "undeterminable_wording"
  | "absent_without_declaration"
  | "clause_number_gap"
  | "duplicate_criterion_question"
  | "criterion_not_in_rule";

/** 「以附件一为准」但正文里没有附件内容。 */
const ATTACHMENT_REF_RE = /(附件|附录)\s*[一二三四五六七八九十\d]+/gu;
const ATTACHMENT_HEADING_RE = /^(附件|附录)\s*[一二三四五六七八九十\d]+/u;

/** 无确定标准的措辞：模型只能答 unknown，评分无意义。 */
const UNDETERMINABLE_RE = /按法律规定|另行协商|视情况|依法确定|由双方另行约定|以实际发生为准/gu;

/** 显式声明缺失的句子。 */
const ABSENCE_DECLARATION_RE = /未(就|对)?.{0,12}(约定|规定)|没有约定|未作约定|未约定|均未约定/u;

/** 中文序号条款：第一条 / 第二条 … */
const CLAUSE_NUMBER_RE = /^第([一二三四五六七八九十百]+)条/u;

const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function cnNumberToInt(raw: string): number | undefined {
  if (raw === "十") {
    return 10;
  }
  if (raw.length === 1) {
    return CN_DIGITS[raw];
  }
  if (raw.startsWith("十")) {
    const rest = CN_DIGITS[raw.slice(1)];
    return rest === undefined ? undefined : 10 + rest;
  }
  if (raw.endsWith("十")) {
    const head = CN_DIGITS[raw.slice(0, -1)];
    return head === undefined ? undefined : head * 10;
  }
  const [tens, ones] = [raw[0], raw[2]];
  const t = tens ? CN_DIGITS[tens] : undefined;
  const o = ones ? CN_DIGITS[ones] : undefined;
  if (t === undefined || o === undefined) {
    return undefined;
  }
  return t * 10 + o;
}

/** Referenced attachment labels in the body. */
function referencedAttachments(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(ATTACHMENT_REF_RE)) {
    const label = match[0].replace(/\s+/gu, "");
    if (label) {
      found.add(label);
    }
  }
  return [...found];
}

/** Attachment labels the fixture actually provides as a heading block. */
function providedAttachments(clauses: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const clause of clauses) {
    const match = ATTACHMENT_HEADING_RE.exec(clause.trim());
    if (match) {
      out.add(match[0].replace(/\s+/gu, ""));
    }
  }
  return out;
}

function clauseNumbers(clauses: readonly string[]): number[] {
  const out: number[] = [];
  for (const clause of clauses) {
    const match = CLAUSE_NUMBER_RE.exec(clause.trim());
    if (match?.[1]) {
      const n = cnNumberToInt(match[1]);
      if (n !== undefined) {
        out.push(n);
      }
    }
  }
  return out;
}

/**
 * Check one fixture case. `rules` supplies the criterion ids so an expectation
 * pointing at a rule that is not in the playbook is caught here rather than at
 * scoring time.
 */
export function checkFixtureCase(
  testCase: RuleAllPassCase,
  rules: readonly ReviewRule[],
): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const clauses = testCase.clauses ?? [];
  const text = clauses.join("\n");

  // 1. Dangling attachment reference: 「以附件一为准」 with no 附件一 block.
  const provided = providedAttachments(clauses);
  for (const label of referencedAttachments(text)) {
    if (!provided.has(label)) {
      findings.push({
        caseId: testCase.caseId,
        code: "dangling_attachment",
        problem: `引用了「${label}」但正文没有该附件内容；模型只能判 needs_human`,
      });
    }
  }

  // 2. Wording with no determinate standard.
  for (const match of text.matchAll(UNDETERMINABLE_RE)) {
    findings.push({
      caseId: testCase.caseId,
      code: "undeterminable_wording",
      problem: `出现无确定标准的措辞「${match[0]}」；要么给出可核标准，要么删掉`,
    });
  }

  // 3. `absent` expected but the contract never says so explicitly.
  const absentRules = Object.entries(testCase.expected)
    .filter(([, kind]) => kind === "absent")
    .map(([ruleId]) => ruleId);
  if (absentRules.length > 0 && !ABSENCE_DECLARATION_RE.test(text)) {
    findings.push({
      caseId: testCase.caseId,
      code: "absent_without_declaration",
      problem:
        `期望 ${absentRules.join("、")} 为 absent，但正文没有「未约定…」的显式声明；` +
        "模型无法区分「缺失」与「材料不全」",
    });
  }

  // 4. Clause numbering gap without a declaration (e.g. 一、二、六 with no note).
  const numbers = clauseNumbers(clauses);
  if (numbers.length >= 2) {
    const unique = [...new Set(numbers)].toSorted((a, b) => a - b);
    const max = unique.at(-1)!;
    const missing: number[] = [];
    for (let n = unique[0]; n <= max; n += 1) {
      if (!unique.includes(n)) {
        missing.push(n);
      }
    }
    if (missing.length > 0 && !ABSENCE_DECLARATION_RE.test(text)) {
      findings.push({
        caseId: testCase.caseId,
        code: "clause_number_gap",
        problem: `条款序号跳号（缺第 ${missing.join("、")} 条）且未声明缺失`,
      });
    }
  }

  // 5. Expectation must name rules that exist.
  const known = new Set(rules.map((r) => r.ruleId));
  for (const ruleId of Object.keys(testCase.expected)) {
    if (!known.has(ruleId)) {
      findings.push({
        caseId: testCase.caseId,
        code: "criterion_not_in_rule",
        problem: `期望里的规则 ${ruleId} 不在该 playbook 中`,
      });
    }
  }

  return findings;
}

/**
 * Rule-side check: two criteria asking literally the same question make the
 * answer ambiguous (which one does the verdict come from?).
 */
export function checkRuleCriteria(rules: readonly ReviewRule[]): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  for (const rule of rules) {
    const seen = new Map<string, string>();
    for (const criterion of rule.criteria) {
      const key = criterion.question.replace(/\s+/gu, "");
      const existing = seen.get(key);
      if (existing) {
        findings.push({
          caseId: rule.ruleId,
          code: "duplicate_criterion_question",
          problem: `criterion ${existing} 与 ${criterion.id} 问的是同一件事`,
        });
      }
      seen.set(key, criterion.id);
    }
  }
  return findings;
}

export function checkFixtures(
  cases: readonly RuleAllPassCase[],
  rules: readonly ReviewRule[],
): IntegrityFinding[] {
  return [
    ...checkRuleCriteria(rules),
    ...cases.flatMap((testCase) => checkFixtureCase(testCase, rules)),
  ];
}

export function formatIntegrityFindings(findings: readonly IntegrityFinding[]): string {
  return findings.map((f) => `- ${f.caseId || "(全局)"} [${f.code}] ${f.problem}`).join("\n");
}
