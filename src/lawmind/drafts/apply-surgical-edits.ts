/**
 * Apply exact find/replace pairs onto draft section bodies (surgical contract path).
 * Hard span-locality gate: many edits OK; each find must be a short anchor (not whole sentence/paragraph).
 */

import type { ArtifactDraft, ArtifactSection } from "../types.js";
import { craftSignalsForEdit, type SurgicalCraftSignal } from "./contract-redline-craft.js";
import { computeMinimalEditSpans } from "./minimal-edit-script.js";
import {
  commonAffixLength,
  explainSurgicalSpanViolation,
  SURGICAL_MAX_FIND_WITH_TERMINATOR,
} from "./surgical-span-gate.js";
import { introducedTerminologyDrift, type TerminologyDrift } from "./terminology-adapt.js";

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
        /** 本处由一处较粗的 find/replace 自动拆出的最短改动。 */
        minimalSplit?: boolean;
      }>;
      skipped: Array<{ find: string; replace: string; reason: string }>;
      craftSignals: SurgicalCraftSignal[];
      /** 因「夹着没改的文字」被自动拆成多处的输入编辑条数。 */
      minimalSplitEdits: number;
      /**
       * 本次落改**新引入**的外来当事人叫法（术语自适应兜底，不阻断）。
       * 改写前已存在的不报——避免对原本就没定义的称谓反复报警。
       */
      terminologyWarnings: TerminologyDrift[];
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

/** 一处输入编辑最多拆成多少段最短改动；超出则退回「收窄锚定」的单处写法。 */
const MAX_SPANS_PER_EDIT = 64;

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
    minimalSplit?: boolean;
  }> = [];
  const craftSignals: SurgicalCraftSignal[] = [];
  let minimalSplitEdits = 0;

  for (const raw of params.edits) {
    const find = typeof raw.find === "string" ? raw.find : "";
    const replace = typeof raw.replace === "string" ? raw.replace : "";
    const note = typeof raw.note === "string" ? raw.note.trim() : undefined;
    if (!find) {
      skipped.push({ find: "", replace: replace.slice(0, 40), reason: "find 为空" });
      continue;
    }
    if (find === replace) {
      skipped.push({
        find: find.slice(0, 40),
        replace: replace.slice(0, 40),
        reason: "find 与 replace 相同",
      });
      continue;
    }
    // 最短改动硬不变量：不信 find/replace 的粒度，一律重算成若干最短改动。
    // 这样「一句话里只改几个字」不会被写成整句删+整句增（多人协作必须能逐处接受）。
    const spans = computeMinimalEditSpans(find, replace);
    if (spans.length === 0) {
      skipped.push({
        find: find.slice(0, 40),
        replace: replace.slice(0, 40),
        reason: "find 与 replace 相同",
      });
      continue;
    }
    // 极端碎片化保护：一处编辑拆出过多小改动时，退回「收窄锚定」的单处写法。
    const tooFragmented = spans.length > MAX_SPANS_PER_EDIT;
    const planned = tooFragmented
      ? (() => {
          const narrowedEdit = tryNarrowSurgicalEdit(find, replace);
          return narrowedEdit
            ? [
                {
                  spanStart: 0,
                  spanEnd: find.length,
                  before: narrowedEdit.find,
                  after: narrowedEdit.replace,
                },
              ]
            : null;
        })()
      : spans;
    if (!planned) {
      skipped.push({
        find: find.slice(0, 40),
        replace: replace.slice(0, 40),
        reason: "改动过于碎片化且无法收窄为单处最短锚定；请按实质应改点分条提交。",
      });
      continue;
    }

    let hitIndex = -1;
    for (let i = 0; i < sections.length; i += 1) {
      if (sections[i].body.includes(find)) {
        hitIndex = i;
        break;
      }
    }
    if (hitIndex < 0) {
      skipped.push({
        find: find.slice(0, 40),
        replace: replace.slice(0, 40),
        reason: "正文中未找到 find 原文（请用 analyze 可见的精确原文）",
      });
      continue;
    }

    const beforeBody = sections[hitIndex].body;
    const base = beforeBody.indexOf(find);
    // 从右往左落盘：右侧改动不影响左侧下标；同一处编辑拆出的多段互不重叠。
    const ordered = [...planned].toSorted((a, b) => (b.spanStart ?? 0) - (a.spanStart ?? 0));
    let nextBody = beforeBody;
    const splitMark = planned.length > 1;
    // 输入这对 find/replace 是否被重算过（粒度不符最短改动）——重算过就在回执里留痕。
    const minimizedInput =
      splitMark || planned[0]?.before !== find || planned[0]?.after !== replace;
    // 回执按文档顺序（从左到右）排列，便于律师顺着正文核对；落盘顺序仍是右→左。
    const editApplied: Array<{
      spanStart: number;
      entry: (typeof appliedList)[number];
    }> = [];
    for (const span of ordered) {
      const from = base + (span.spanStart ?? 0);
      const to =
        typeof span.spanEnd === "number" && span.spanEnd >= (span.spanStart ?? 0)
          ? base + span.spanEnd
          : from + span.before.length;
      const slice = nextBody.slice(from, to);
      if (slice !== span.before) {
        // 下标漂移（理论上不应发生）：退回子串替换，绝不按错位置改。
        const drifted = nextBody.indexOf(span.before);
        if (drifted < 0) {
          skipped.push({
            find: span.before.slice(0, 40),
            replace: span.after.slice(0, 40),
            reason: "落改时下标漂移且无法定位原文，已跳过该处（其余处已落）。",
          });
          continue;
        }
        nextBody =
          nextBody.slice(0, drifted) + span.after + nextBody.slice(drifted + span.before.length);
      } else {
        nextBody = nextBody.slice(0, from) + span.after + nextBody.slice(to);
      }
      craftSignals.push(...craftSignalsForEdit(span.before, span.after));
      const appliedNote = [
        note,
        splitMark ? "已按最短改动拆分" : minimizedInput ? "已收窄锚定" : undefined,
        tooFragmented ? "已收窄锚定" : undefined,
      ]
        .filter(Boolean)
        .join("；");
      editApplied.push({
        spanStart: span.spanStart ?? 0,
        entry: {
          find: span.before,
          replace: span.after,
          ...(appliedNote ? { note: appliedNote } : {}),
          sectionIndex: hitIndex,
          sectionHeading: sections[hitIndex].heading,
          ...(splitMark ? { minimalSplit: true as const } : {}),
        },
      });
    }
    for (const row of editApplied.toSorted((a, b) => a.spanStart - b.spanStart)) {
      appliedList.push(row.entry);
    }
    if (nextBody !== beforeBody) {
      if (splitMark) {
        minimalSplitEdits += 1;
      }
      sections[hitIndex] = { ...sections[hitIndex], body: nextBody };
    }
  }

  if (appliedList.length === 0) {
    return {
      ok: false,
      code: "none_applied",
      error: [
        "未能应用任何 find/replace。请确认 find 为正文中可精确匹配的原文。",
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
    minimalSplitEdits,
    terminologyWarnings: introducedTerminologyDrift(
      sectionsText(params.sections),
      sectionsText(sections),
    ),
  };
}

function sectionsText(sections: ArtifactSection[]): string {
  return (sections ?? []).map((s) => s.body ?? "").join("\n");
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
