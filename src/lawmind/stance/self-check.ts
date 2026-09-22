/**
 * Stance self-check: report unused high-confidence positions. Never auto-edits.
 */

import { clauseTypeMentionedIn } from "../clause/clause-type-keywords.js";
import { lintFinding as finding } from "../lint/finding.js";
import type { LegalLintFinding } from "../lint/types.js";
import { readStanceItems } from "./store.js";

const MIN_CONFIDENCE = 0.4;
const MIN_NEEDLE = 8;

const STANCE_UNAPPLIED = { id: "stance.unapplied", family: "form" as const };

function needleOf(preferredLanguage: string): string {
  return preferredLanguage.replace(/\s+/g, "").slice(0, 16);
}

/**
 * Residual-only: if the draft talks about a clause type but misses the lawyer's
 * preferred wording, escalate. Empty stance store → no findings (do not seed).
 *
 * P0-4d：条款判据改从 `clause/clause-type-keywords.ts` 取（此前本文件自带一份
 * `CLAUSE_IN_TEXT`，与 `habit-extract` / `stance/capture` 的表**不一致**）。
 * 本处**有意**放宽「管辖」以包含 `人民法院` 提及：自检只问「正文是否谈到该类条款」，
 * 多一条 info 级提示不会造成误分类；而分类用途（红线、习惯聚类）不允许放宽。
 */
export function stanceSelfCheck(workspaceDir: string, text: string): LegalLintFinding[] {
  const body = text ?? "";
  if (body.trim().length < 20) {
    return [];
  }
  const items = readStanceItems(workspaceDir).filter(
    (it) => !it.supersededBy && it.confidence >= MIN_CONFIDENCE,
  );
  if (items.length === 0) {
    return [];
  }
  const out: LegalLintFinding[] = [];
  for (const item of items) {
    if (!clauseTypeMentionedIn(body, item.clauseType, { includeForumMentions: true })) {
      continue;
    }
    const needle = needleOf(item.preferredLanguage);
    if (needle.length < MIN_NEEDLE) {
      continue;
    }
    if (body.includes(needle) || body.includes(item.preferredLanguage.slice(0, MIN_NEEDLE))) {
      continue;
    }
    out.push(
      finding(
        STANCE_UNAPPLIED,
        "info",
        `本所立场未落入「${item.clauseType}」：建议采用「${item.preferredLanguage.slice(0, 80)}」。未代为改稿。`,
        { anchor: item.clauseType, fixable: false },
      ),
    );
  }
  return out;
}
