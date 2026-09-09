/**
 * Stance self-check: report unused high-confidence positions. Never auto-edits.
 */

import { lintFinding as finding } from "../lint/finding.js";
import type { LegalLintFinding } from "../lint/types.js";
import { readStanceItems } from "./store.js";

const MIN_CONFIDENCE = 0.4;
const MIN_NEEDLE = 8;

const CLAUSE_IN_TEXT: Array<{ id: string; re: RegExp }> = [
  { id: "管辖", re: /管辖|争议解决|仲裁|人民法院/ },
  { id: "违约金", re: /违约金/ },
  { id: "保密", re: /保密/ },
  { id: "赔偿", re: /赔偿|责任限制|责任上限/ },
  { id: "知识产权", re: /知识产权|许可使用/ },
  { id: "定金", re: /定金/ },
];

const STANCE_UNAPPLIED = { id: "stance.unapplied", family: "form" as const };

function needleOf(preferredLanguage: string): string {
  return preferredLanguage.replace(/\s+/g, "").slice(0, 16);
}

/**
 * Residual-only: if the draft talks about a clause type but misses the lawyer's
 * preferred wording, escalate. Empty stance store → no findings (do not seed).
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
    const trigger = CLAUSE_IN_TEXT.find((row) => row.id === item.clauseType);
    if (!trigger || !trigger.re.test(body)) {
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
