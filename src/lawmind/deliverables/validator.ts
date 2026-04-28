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
import { heuristicPlaceholderRatio } from "./draft-sanity.js";
import { getDeliverableSpec } from "./registry.js";
import type {
  AcceptanceCheck,
  DeliverableSpec,
  ValidateDraftFn,
  ValidateDraftOptions,
} from "./types.js";

const DEFAULT_PLACEHOLDER_PATTERN = /【待补充[:：][^】]*】/g;

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
    label: must ? "所有【待补充：xxx】占位符已替换" : "占位符可保留至客户最终签署前",
    passed,
    severity: must ? "blocker" : "warning",
    hint: passed
      ? undefined
      : `仍有 ${placeholders.length} 个待补充占位符，需在最终交付前替换为实际内容。`,
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

/** Warn when heuristic placeholder density is high vs finished prose (supplement to explicit 【待补充】). */
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
  const spec = opts.spec ?? getDeliverableSpec(draft.deliverableType);
  const generatedAt = new Date().toISOString();

  if (!spec) {
    return {
      taskId: draft.taskId,
      deliverableType: draft.deliverableType,
      ready: true,
      checks: [
        {
          key: "spec.not_found",
          label: "未找到对应交付物规范，跳过结构化验收。",
          passed: true,
          severity: "warning",
          hint: "可在 src/lawmind/deliverables/registry.ts 注册新的 DeliverableSpec。",
        },
      ],
      blockerCount: 0,
      warningCount: 1,
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

  const blockerCount = checks.filter((c) => c.severity === "blocker" && !c.passed).length;
  const warningCount = checks.filter((c) => c.severity === "warning" && !c.passed).length;

  return {
    taskId: draft.taskId,
    deliverableType: draft.deliverableType,
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
