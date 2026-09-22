/**
 * G3：判定表键 → 律师可读标签。
 *
 * **刻意从既有检查单派生，不手写 150 条。** 理由：标签已经存在于
 * `word-revision-packs.ts` 的 `look` 与 `verification-checklist.ts` 的 `label` 里；
 * 再抄一份就会**漂移**——本仓刚在 P0-4d 修过一次同类问题
 * （条款类型关键词三份副本，其中一份已经不一致，见 `clause/clause-type-keywords.ts`）。
 *
 * 派生不出标签时返回 `undefined`，由调用方决定回落（通常是显示键本身）。
 * **不回落到空字符串**——那会让 UI 出现空白条目，比显示键更糟。
 */

import { listVerificationChecklistSpecs } from "../deliverables/verification-checklist.js";
import { verificationKey, wordRevisionKey } from "../guardian/judgment-tier.js";
import { WORD_REVISION_PACKS } from "../platform/word-revision-packs.js";

function buildLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pack of Object.values(WORD_REVISION_PACKS) as Array<{
    items: Array<{ id: string; look: string }>;
  }>) {
    for (const item of pack.items) {
      const label = item.look?.trim();
      if (label) {
        out[wordRevisionKey(item.id)] = label;
      }
    }
  }
  for (const spec of listVerificationChecklistSpecs()) {
    for (const item of spec.items) {
      const label = item.label?.trim();
      if (label) {
        out[verificationKey(spec.id, item.id)] = label;
      }
    }
  }
  return out;
}

/** 判定表键 → 律师可读标签。缺键即 `undefined`（不编空串）。 */
export const ITEM_JUDGMENT_LABELS: Readonly<Record<string, string>> = buildLabels();

/** 取标签；取不到时回落给定的 fallback（通常是键本身，便于工程排查）。 */
export function judgmentLabel(key: string, fallback?: string): string {
  const found = ITEM_JUDGMENT_LABELS[key]?.trim();
  if (found) {
    return found;
  }
  return fallback?.trim() ? fallback : key;
}
