/**
 * Apply exact find/replace pairs onto draft section bodies (surgical contract path).
 * Hard span-locality gate: many edits OK; each find must be a short anchor (not whole sentence/paragraph).
 */

import type { ArtifactDraft, ArtifactSection } from "../types.js";
import { craftSignalsForEdit, type SurgicalCraftSignal } from "./contract-redline-craft.js";
import {
  commonAffixLength,
  explainSurgicalSpanViolation,
  SURGICAL_MAX_FIND_WITH_TERMINATOR,
} from "./surgical-span-gate.js";

export { commonAffixLength };

export type SurgicalTextEdit = {
  find: string;
  replace: string;
  note?: string;
};

export type ApplySurgicalEditsResult =
  | {
      ok: true;
      sections: ArtifactSection[];
      applied: Array<{
        find: string;
        replace: string;
        note?: string;
        sectionIndex: number;
        sectionHeading: string;
      }>;
      skipped: Array<{ find: string; replace: string; reason: string }>;
      craftSignals: SurgicalCraftSignal[];
    }
  | {
      ok: false;
      error: string;
      code: string;
      skipped?: Array<{ find: string; replace: string; reason: string }>;
    };

/**
 * Absolute safety rail only (abuse / accidental megabatch). Not a product edit-count quota.
 */
const ABSURD_BATCH_CEILING = 500;

/** Hard validity: empty/identical + span-locality. */
export function explainInvalidSurgicalEdit(find: string, replace: string): string | undefined {
  if (!find) {
    return "find 为空";
  }
  if (find === replace) {
    return "find 与 replace 相同";
  }
  return explainSurgicalSpanViolation(find, replace);
}

/**
 * If a pair fails the span gate, shrink to the shortest differing span.
 * Used internally so the model does not need a lawyer-facing retry.
 */
export function tryNarrowSurgicalEdit(
  find: string,
  replace: string,
): { find: string; replace: string } | undefined {
  const { prefix, suffix } = commonAffixLength(find, replace);
  if (prefix + suffix < 2) {
    return undefined;
  }
  const end = find.length - suffix;
  if (end <= prefix) {
    return undefined;
  }
  const narrowFind = find.slice(prefix, end);
  const narrowReplace = replace.slice(prefix, replace.length - suffix);
  if (!narrowFind || narrowFind === narrowReplace) {
    return undefined;
  }
  if (narrowFind.length > SURGICAL_MAX_FIND_WITH_TERMINATOR) {
    return undefined;
  }
  if (explainInvalidSurgicalEdit(narrowFind, narrowReplace)) {
    return undefined;
  }
  return { find: narrowFind, replace: narrowReplace };
}

/** @deprecated Alias — span gate is part of invalidity now. */
export function explainNonMinimalSurgicalEdit(find: string, replace: string): string | undefined {
  return explainInvalidSurgicalEdit(find, replace);
}

export function applySurgicalTextEdits(params: {
  sections: ArtifactSection[];
  edits: SurgicalTextEdit[];
}): ApplySurgicalEditsResult {
  if (!Array.isArray(params.sections) || params.sections.length === 0) {
    return {
      ok: false,
      code: "no_sections",
      error:
        "草稿尚无正文 sections：请先 update_draft/draft_document 并 seed_sections_from_baseline=true。",
    };
  }
  if (!Array.isArray(params.edits) || params.edits.length === 0) {
    return { ok: false, code: "no_edits", error: "edits 不能为空；请提供至少 1 组 find/replace。" };
  }
  if (params.edits.length > ABSURD_BATCH_CEILING) {
    return {
      ok: false,
      code: "absurd_batch",
      error: `edits 异常过大（${params.edits.length}），疑似误传；请按实质应改点提交 find/replace（条数可多，但每处须最短锚定）。`,
    };
  }

  const sections = params.sections.map((s) => ({
    ...s,
    body: s.body ?? "",
    citations: s.citations ? [...s.citations] : undefined,
  }));
  const skipped: Array<{ find: string; replace: string; reason: string }> = [];
  const appliedList: Array<{
    find: string;
    replace: string;
    note?: string;
    sectionIndex: number;
    sectionHeading: string;
  }> = [];
  const craftSignals: SurgicalCraftSignal[] = [];

  for (const raw of params.edits) {
    const find = typeof raw.find === "string" ? raw.find : "";
    const replace = typeof raw.replace === "string" ? raw.replace : "";
    const note = typeof raw.note === "string" ? raw.note.trim() : undefined;
    const invalid = explainInvalidSurgicalEdit(find, replace);
    let useFind = find;
    let useReplace = replace;
    let narrowed = false;
    if (invalid) {
      const narrowedEdit = tryNarrowSurgicalEdit(find, replace);
      if (!narrowedEdit) {
        skipped.push({ find: find.slice(0, 40), replace: replace.slice(0, 40), reason: invalid });
        continue;
      }
      useFind = narrowedEdit.find;
      useReplace = narrowedEdit.replace;
      narrowed = true;
    }

    let hitIndex = -1;
    for (let i = 0; i < sections.length; i += 1) {
      if (sections[i].body.includes(useFind)) {
        hitIndex = i;
        break;
      }
    }
    if (hitIndex < 0) {
      skipped.push({
        find,
        replace,
        reason: narrowed
          ? "收窄后仍未在正文找到锚定（请用 analyze 可见的精确原文）"
          : "正文中未找到 find 原文（请用 analyze 可见的精确原文）",
      });
      continue;
    }

    craftSignals.push(...craftSignalsForEdit(useFind, useReplace));

    const beforeBody = sections[hitIndex].body;
    const afterBody = beforeBody.replace(useFind, useReplace);
    sections[hitIndex] = { ...sections[hitIndex], body: afterBody };
    const appliedNote = [note, narrowed ? "已收窄锚定" : undefined].filter(Boolean).join("；");
    appliedList.push({
      find: useFind,
      replace: useReplace,
      ...(appliedNote ? { note: appliedNote } : {}),
      sectionIndex: hitIndex,
      sectionHeading: sections[hitIndex].heading,
    });
  }

  if (appliedList.length === 0) {
    const spanBlocked = skipped.some((s) => s.reason.includes("跨度硬门禁"));
    return {
      ok: false,
      code: spanBlocked ? "span_too_wide" : "none_applied",
      error: [
        spanBlocked
          ? "全部落改被跨度硬门禁拒绝：每一处 find 必须是最短字/词锚定（能改几个字就只改几个字；勿整句/整段删写）。条数不限，请拆短后重试。"
          : "未能应用任何 find/replace。请确认 find 为正文中可精确匹配的原文。",
        skipped
          .slice(0, 3)
          .map((s) => s.reason)
          .join("；"),
      ]
        .filter(Boolean)
        .join(""),
      skipped,
    };
  }

  return {
    ok: true,
    sections,
    applied: appliedList,
    skipped,
    craftSignals,
  };
}

export function parseSurgicalEditsInput(value: unknown): SurgicalTextEdit[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("edits 必须是非空数组，每项为 { find, replace, note? }");
  }
  return value.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`edits[${idx}] 格式无效`);
    }
    const record = item as Record<string, unknown>;
    const find = typeof record.find === "string" ? record.find : "";
    const replace = typeof record.replace === "string" ? record.replace : "";
    const note = typeof record.note === "string" ? record.note : undefined;
    if (!find) {
      throw new Error(`edits[${idx}].find 不能为空`);
    }
    return { find, replace, ...(note !== undefined ? { note } : {}) };
  });
}

/** Convenience: apply onto a draft object (does not persist). */
export function applySurgicalEditsToDraft(
  draft: ArtifactDraft,
  edits: SurgicalTextEdit[],
): ApplySurgicalEditsResult {
  return applySurgicalTextEdits({ sections: draft.sections, edits });
}
