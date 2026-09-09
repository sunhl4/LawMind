/**
 * Compile 推荐措辞 / 建议改为 pairs from opinion sections into a redline plan.
 * Unlocked contract.review + pinned Word only. Never invent find text.
 */

import type { ArtifactDraft, ArtifactSection } from "../types.js";
import type { SurgicalTextEdit } from "./apply-surgical-edits.js";
import { extractStructuredReviewEdits } from "./contract-review-edits.js";
import { normalizeRedlinePlanItems, writeRedlinePlan, type RedlinePlan } from "./redline-plan.js";

const PAIR_PATTERNS: RegExp[] = [
  /「([^」]{2,80})」\s*(?:→|->|改为|改成|替换为)\s*「([^」]{1,120})」/g,
  /“([^”]{2,80})”\s*(?:→|->|改为|改成|替换为)\s*“([^”]{1,120})”/g,
  /原句[：:]\s*[「“"]([^」”"]{2,80})[」”"]\s*(?:推荐措辞|改为|改成)[：:]?\s*[「“"]([^」”"]{1,120})[」”"]/g,
  /find\s*[＝=:]\s*[「“"]?([^」”"\n]{2,80})[」”"]?\s*[,，;；]\s*replace\s*[＝=:]\s*[「“"]?([^」”"\n]{1,120})[」”"]?/gi,
];

const TARGET_HEADINGS = /修改建议|微观条款|主要风险|推荐措辞/;

export function parseRecommendedWordingEdits(sections: ArtifactSection[]): SurgicalTextEdit[] {
  const out: SurgicalTextEdit[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    if (!TARGET_HEADINGS.test(section.heading) && !/推荐措辞|建议改为/.test(section.body)) {
      continue;
    }
    const text = section.body;
    for (const pattern of PAIR_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const find = m[1]?.trim() ?? "";
        const replace = m[2]?.trim() ?? "";
        if (!find || !replace || find === replace) {
          continue;
        }
        if (find.startsWith("【") || /^待补充|可替换原句/.test(find)) {
          continue;
        }
        const key = `${find}=>${replace}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        out.push({
          find,
          replace,
          note: `来自意见「${section.heading}」推荐措辞`,
        });
      }
    }
  }
  return out;
}

export function buildRedlinePlanFromOpinion(input: {
  taskId: string;
  sections: ArtifactSection[];
}): RedlinePlan {
  const raw = parseRecommendedWordingEdits(input.sections);
  const { items, skipped } = normalizeRedlinePlanItems(raw);
  return {
    taskId: input.taskId,
    items,
    skipped,
    updatedAt: new Date().toISOString(),
  };
}

/** Write sidecar when opinion has parseable pairs. Returns plan (possibly empty items). */
export function writeRedlinePlanFromOpinion(
  workspaceDir: string,
  draft: ArtifactDraft,
): RedlinePlan {
  const sections = [...(draft.pairedOpinionSections ?? []), ...draft.sections];
  const raw = [...extractStructuredReviewEdits(draft), ...parseRecommendedWordingEdits(sections)];
  const { items, skipped } = normalizeRedlinePlanItems(raw);
  const plan: RedlinePlan = {
    taskId: draft.taskId,
    items,
    skipped,
    updatedAt: new Date().toISOString(),
  };
  if (plan.items.length > 0 || plan.skipped.length > 0) {
    writeRedlinePlan(workspaceDir, plan);
  }
  return plan;
}
