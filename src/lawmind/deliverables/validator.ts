/**
 * Acceptance Gate validator.
 *
 * 给草稿做"我敢交"的体检：
 *   - 必要章节是否齐全
 *   - 占位符是否符合规则
 *   - acceptanceCriteria 是否被章节覆盖
 *   - 是否还有未关闭的 clarification 问题
 *
 * 输出 AcceptanceReport：blocker 全过 → ready=true，可允许 render；
 * 否则桌面 UI 应显示清单并阻止"导出最终文书"。
 */

import type { ArtifactDraft, ArtifactSection } from "../types.js";
import { inferDeliverableTypeForAcceptance } from "./draft-deliverable-infer.js";
import { heuristicPlaceholderRatio } from "./draft-sanity.js";
import {
  countScaffoldPlaceholdersInDraft,
  DEFAULT_PLACEHOLDER_PATTERN,
  isHighScaffoldDensity,
} from "./placeholder-pattern.js";
import { getDeliverableSpec } from "./registry.js";
import type {
  AcceptanceCheck,
  DeliverableSpec,
  ValidateDraftFn,
  ValidateDraftOptions,
} from "./types.js";

function normalizeHeading(heading: string): string {
  return heading.replace(/\s+/g, "").toLowerCase();
}

function sectionMatches(section: ArtifactSection, keywords: string[]): boolean {
  const haystack = `${normalizeHeading(section.heading)} ${normalizeHeading(section.body.slice(0, 80))}`;
  return keywords.some((keyword) => haystack.includes(normalizeHeading(keyword)));
}

function findPlaceholders(draft: ArtifactDraft, pattern: RegExp): string[] {
  const matches: string[] = [];
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  for (const section of draft.sections) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(section.body)) !== null) {
      matches.push(m[0]);
    }
  }
  for (const note of draft.reviewNotes) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(note)) !== null) {
      matches.push(m[0]);
    }
  }
  return matches;
}

function buildSectionChecks(draft: ArtifactDraft, spec: DeliverableSpec): AcceptanceCheck[] {
  return spec.requiredSections.map((req, idx) => {
    const passed = draft.sections.some((section) => sectionMatches(section, req.headingKeywords));
    return {
      key: `section.${idx}.${req.headingKeywords[0] ?? "section"}`,
      label: `${req.purpose}（关键词：${req.headingKeywords.join(" / ")}）`,
      passed,
      severity: req.severity,
      hint: passed
        ? undefined
        : `未发现"${req.purpose}"对应章节。建议补充包含 ${req.headingKeywords.join("、")} 等关键词的章节。`,
    };
  });
}

function buildPlaceholderCheck(
  draft: ArtifactDraft,
  spec: DeliverableSpec,
  placeholders: string[],
): AcceptanceCheck {
  const must = spec.placeholderRule.mustResolveBeforeRender;
  const passed = must ? placeholders.length === 0 : true;
  return {
    key: "placeholders.resolved",
    label: must ? "文中仍有未填项（【…】）须替换后再导出" : "占位符可保留至客户最终签署前",
    passed,
    severity: must ? "blocker" : "warning",
    hint: passed
      ? undefined
      : `仍有 ${placeholders.length} 个未填项（【…】），需在最终交付前替换为实际内容。`,
  };
}

function concatDraftPlainText(draft: ArtifactDraft): string {
  const parts: string[] = [];
  for (const s of draft.sections) {
    parts.push(s.heading, "\n", s.body, "\n");
  }
  for (const n of draft.reviewNotes) {
    parts.push(n, "\n");
  }
  return parts.join("");
}

const CONTRACT_REVIEW_CLAUSE_RE =
  /第\s*[一二三四五六七八九十百千0-9]+\s*条|Article\s*\d+|〔待核实〕|\[待核实\]/i;

function buildContractReviewClauseAnchorCheck(
  draft: ArtifactDraft,
  spec: DeliverableSpec,
): AcceptanceCheck | undefined {
  if (spec.type !== "contract.review") {
    return undefined;
  }
  const riskSections = draft.sections.filter((section) =>
    sectionMatches(section, ["风险", "问题"]),
  );
  const body = riskSections.map((section) => section.body).join("\n");
  const passed = CONTRACT_REVIEW_CLAUSE_RE.test(body);
  return {
    key: "contract.review.clause_anchor",
    label: "主要风险须锚定条款（第×条 / Article / 〔待核实〕）",
    passed,
    severity: "blocker",
    hint: passed ? undefined : "风险章节须引用「第×条」或 Article N；无法核实时写〔待核实〕。",
  };
}

const CONTRACT_REVIEW_WORDING_RE = /推荐措辞|建议改为|改为[「「“"]|修订为/;

function buildContractReviewWordingCheck(
  draft: ArtifactDraft,
  spec: DeliverableSpec,
): AcceptanceCheck | undefined {
  if (spec.type !== "contract.review") {
    return undefined;
  }
  const suggest = draft.sections.filter((section) =>
    sectionMatches(section, ["建议", "修改", "调整"]),
  );
  const body = suggest.map((section) => section.body).join("\n");
  const passed = CONTRACT_REVIEW_WORDING_RE.test(body);
  return {
    key: "contract.review.recommended_wording",
    label: "修改建议须含推荐措辞",
    passed,
    severity: "warning",
    hint: passed ? undefined : "每个风险点写可替换原句；仅意见时写明「仅意见」。",
  };
}

function buildBodySanityCheck(draft: ArtifactDraft): AcceptanceCheck | undefined {
  const text = concatDraftPlainText(draft);
  if (text.trim().length < 400) {
    return undefined;
  }
  const ratio = heuristicPlaceholderRatio(text);
  const threshold = 0.38;
  const passed = ratio <= threshold;
  return {
    key: "draft.body.placeholder_density_heuristic",
    label: "正文占位/待填密度（启发式）",
    passed,
    severity: "warning",
    hint: passed
      ? undefined
      : `启发式评分 ${ratio.toFixed(2)} 超过建议阈值 ${threshold}，草稿可能仍含大量占位或待填内容；请核对后再交付。`,
  };
}

function buildScaffoldDensityCheck(draft: ArtifactDraft): AcceptanceCheck | undefined {
  const samples = countScaffoldPlaceholdersInDraft(draft.sections);
  const plainLen = concatDraftPlainText(draft).trim().length;
  if (samples.length === 0) {
    return undefined;
  }
  const dense = isHighScaffoldDensity(samples, plainLen);
  return {
    key: "draft.scaffold_density",
    label: dense ? "仍为骨架稿，须由模型或律师补全后再交付" : "文中仍有未填项",
    passed: !dense,
    severity: dense ? "blocker" : "warning",
    hint: dense
      ? `检出 ${samples.length} 处骨架占位（如 ${samples.slice(0, 3).join("、")}）。这是模板填空，不能当作已验收导出。`
      : undefined,
  };
}

function buildClarificationCheck(draft: ArtifactDraft): AcceptanceCheck | undefined {
  const open = draft.clarificationQuestions ?? [];
  if (open.length === 0) {
    return undefined;
  }
  return {
    key: "clarifications.closed",
    label: "律师追问已关闭",
    passed: false,
    severity: "warning",
    hint: `仍有 ${open.length} 项律师追问未关闭：${open
      .map((q) => q.question)
      .slice(0, 2)
      .join("；")}${open.length > 2 ? "…" : ""}`,
  };
}

function buildCriteriaCoverageCheck(draft: ArtifactDraft, spec: DeliverableSpec): AcceptanceCheck {
  const criteria = spec.acceptanceCriteria;
  if (criteria.length === 0) {
    return {
      key: "criteria.coverage",
      label: "验收标准覆盖",
      passed: true,
      severity: "warning",
    };
  }
  // 简单结构覆盖：必要章节全过即视为 acceptanceCriteria 已被结构性覆盖。
  // 真正的语义覆盖留给后续 LLM-graded eval。
  const sectionChecks = buildSectionChecks(draft, spec);
  const blockerSectionsPassed = sectionChecks
    .filter((c) => c.severity === "blocker")
    .every((c) => c.passed);
  return {
    key: "criteria.coverage",
    label: `验收标准覆盖（共 ${criteria.length} 条）`,
    passed: blockerSectionsPassed,
    severity: "warning",
    hint: blockerSectionsPassed
      ? undefined
      : "部分必要章节缺失，导致验收标准未被结构性覆盖；请先补齐 blocker 章节。",
  };
}

export const validateDraftAgainstSpec: ValidateDraftFn = (
  draft,
  opts: ValidateDraftOptions = {},
) => {
  const effectiveType = opts.spec?.type ?? inferDeliverableTypeForAcceptance(draft);
  const spec = opts.spec ?? getDeliverableSpec(effectiveType);
  const generatedAt = new Date().toISOString();

  if (!spec) {
    return {
      taskId: draft.taskId,
      deliverableType: effectiveType ?? draft.deliverableType,
      ready: false,
      checks: [
        {
          key: "spec.not_found",
          label: "未登记该类文书的验收规范，不能当作已验收导出。",
          passed: false,
          severity: "blocker",
          hint: "请先指定已登记的交付物类型，或在工作区注册对应规范后再导出。",
        },
      ],
      blockerCount: 1,
      warningCount: 0,
      placeholderCount: 0,
      placeholderSamples: [],
      generatedAt,
    };
  }

  const placeholderPattern = spec.placeholderRule.pattern ?? DEFAULT_PLACEHOLDER_PATTERN;
  const placeholders = findPlaceholders(draft, placeholderPattern);

  const checks: AcceptanceCheck[] = [];
  checks.push(...buildSectionChecks(draft, spec));
  checks.push(buildPlaceholderCheck(draft, spec, placeholders));
  if (opts.requireCriteriaCoverage !== false) {
    checks.push(buildCriteriaCoverageCheck(draft, spec));
  }
  const clarification = buildClarificationCheck(draft);
  if (clarification) {
    checks.push(clarification);
  }
  const bodySanity = buildBodySanityCheck(draft);
  if (bodySanity) {
    checks.push(bodySanity);
  }
  const clauseAnchor = buildContractReviewClauseAnchorCheck(draft, spec);
  if (clauseAnchor) {
    checks.push(clauseAnchor);
  }
  const wording = buildContractReviewWordingCheck(draft, spec);
  if (wording) {
    checks.push(wording);
  }
  const scaffold = buildScaffoldDensityCheck(draft);
  if (scaffold) {
    checks.push(scaffold);
  }

  const blockerCount = checks.filter((c) => c.severity === "blocker" && !c.passed).length;
  const warningCount = checks.filter((c) => c.severity === "warning" && !c.passed).length;

  return {
    taskId: draft.taskId,
    deliverableType: effectiveType ?? draft.deliverableType,
    ready: blockerCount === 0,
    checks,
    blockerCount,
    warningCount,
    placeholderCount: placeholders.length,
    placeholderSamples: placeholders.slice(0, 5),
    generatedAt,
  };
};

/** 便捷判断：当前草稿是否通过验收门禁（blocker 全过）。 */
export function isDraftReadyForRender(draft: ArtifactDraft, opts?: ValidateDraftOptions): boolean {
  return validateDraftAgainstSpec(draft, opts).ready;
}
