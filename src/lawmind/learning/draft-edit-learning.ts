/**
 * 改稿 delta 学习捕获（对标 Harvey Memory）：
 * 律师在文书台保存终稿时，比较 agent 原稿与律师终稿，抽出「口径候选」入
 * pending adoption——不静默写画像；律师在设置里确认后才落 LAWYER_PROFILE。
 *
 * 与 suggestLearningFromDraftReview（按审核备注）互补：这里看的是律师真改了什么。
 */

import { suggestMemoryAdoption, type MemoryAdoptionRecord } from "../memory/adoption-service.js";
import type { ArtifactDraft } from "../types.js";

const MAX_CANDIDATES = 3;
const MIN_DELTA_CHARS = 6;
const MAX_CANDIDATE_CHARS = 160;

export type DraftEditDelta = {
  sectionHeading: string;
  removed: string;
  added: string;
};

/**
 * 无依赖的变更抽取：取公共前缀/后缀，中间即改动段。
 * 只做「律师改了什么」的事实陈述，不做语义推断。
 */
export function extractChangeSpan(
  before: string,
  after: string,
): { removed: string; added: string } | undefined {
  if (before === after) {
    return undefined;
  }
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before[start] === after[start]) {
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return {
    removed: before.slice(start, endBefore),
    added: after.slice(start, endAfter),
  };
}

/** 逐栏目比较 agent 原稿与律师终稿，只保留真实改动的栏目。 */
export function collectDraftEditDeltas(
  before: Array<{ heading: string; body: string }>,
  after: Array<{ heading: string; body: string }>,
): DraftEditDelta[] {
  const out: DraftEditDelta[] = [];
  const beforeByHeading = new Map(before.map((s) => [s.heading, s.body]));
  for (const section of after) {
    const prev = beforeByHeading.get(section.heading);
    if (prev === undefined) {
      continue;
    }
    const span = extractChangeSpan(prev, section.body);
    if (!span) {
      continue;
    }
    const added = span.added.trim();
    if (added.length < MIN_DELTA_CHARS) {
      continue;
    }
    out.push({
      sectionHeading: section.heading,
      removed: span.removed.trim(),
      added,
    });
  }
  return out;
}

/**
 * 把 delta 转成律师可读的口径候选。只描述「律师改了什么」，不替律师总结法律立场。
 */
export function formatEditLearningCandidates(deltas: DraftEditDelta[]): string[] {
  const out: string[] = [];
  for (const delta of deltas) {
    if (out.length >= MAX_CANDIDATES) {
      break;
    }
    const removed = delta.removed.replace(/\s+/g, " ").trim();
    const added = delta.added.replace(/\s+/g, " ").trim();
    const text = removed
      ? `「${delta.sectionHeading}」：改前「${clip(removed)}」→ 改后「${clip(added)}」`
      : `「${delta.sectionHeading}」：新增「${clip(added)}」`;
    out.push(text.slice(0, MAX_CANDIDATE_CHARS));
  }
  return out;
}

function clip(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * 捕获入口：在 PATCH 正文保存后调用。返回创建的 pending 建议（可能为空）。
 * 不写 LAWYER_PROFILE——确认是在设置里由律师完成。
 */
export async function captureDraftEditLearning(params: {
  workspaceDir: string;
  auditDir: string;
  taskId: string;
  before: Array<{ heading: string; body: string }>;
  after: Array<{ heading: string; body: string }>;
}): Promise<MemoryAdoptionRecord[]> {
  const deltas = collectDraftEditDeltas(params.before, params.after);
  if (deltas.length === 0) {
    return [];
  }
  const candidates = formatEditLearningCandidates(deltas);
  const created: MemoryAdoptionRecord[] = [];
  for (const candidate of candidates) {
    const rec = await suggestMemoryAdoption(params.workspaceDir, params.auditDir, {
      scope: "lawyer",
      kind: "lawyer.profile_learning",
      payload: candidate,
      sourceTaskId: params.taskId,
      origin: "lawyer",
      note: candidate,
    });
    created.push(rec);
  }
  return created;
}

/** 便捷包装：直接从草稿对象取 before/after 栏目。 */
export function draftSectionsOf(draft: Pick<ArtifactDraft, "sections">): Array<{
  heading: string;
  body: string;
}> {
  return draft.sections.map((s) => ({ heading: s.heading, body: s.body }));
}
