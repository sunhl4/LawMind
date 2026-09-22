/**
 * 改稿 delta 学习捕获（对标 Harvey Memory）：
 * 律师在文书台保存终稿时，比较 agent 原稿与律师终稿，抽出「口径候选」入
 * pending adoption——不静默写画像；律师在设置里确认后才落 LAWYER_PROFILE。
 *
 * 与 suggestLearningFromDraftReview（按审核备注）互补：这里看的是律师真改了什么。
 */

import { suggestMemoryAdoption, type MemoryAdoptionRecord } from "../memory/adoption-service.js";
import type { ArtifactDraft } from "../types.js";
import { recordEditExamples, toEditExamples } from "./edit-examples.js";

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
 *
 * ## 两条通道，刻意并存（2026-09-21）
 *
 * 这里同时做两件**不同**的事，不要合并：
 *
 * 1. **偏好通道**（原有）：把改动压成 ≤160 字的候选，进待确认队列，
 *    律师确认后落 `LAWYER_PROFILE.md` —— 一条**每轮都进 system prompt 的指令**。
 * 2. **范例通道**（新增）：把 (改前, 改后) 的**完整对照**存进 `edits/edit-examples.jsonl`
 *    —— 一块**按需检索、只作参照的素材**。
 *
 * 为什么两条都要：偏好是「你应当这样写」（每次都在场，但只有一句话）；
 * 范例是「这种场合长这样」（用到才给，但信息完整）。前者丢失场合与示范，
 * 后者不该每次都占 prompt 预算。
 *
 * 范例写入**永不抛**且不影响返回值——它是可选增强，不是审核的前置条件。
 */
export async function captureDraftEditLearning(params: {
  workspaceDir: string;
  auditDir: string;
  taskId: string;
  before: Array<{ heading: string; body: string }>;
  after: Array<{ heading: string; body: string }>;
  /** 交付物类型：范例检索时最有效的先验（同类型优先）。 */
  deliverableType?: string;
  matterId?: string;
  /** 律师在审核时写的说明——「为什么改」的唯一线索，随范例一起存。 */
  reviewNote?: string;
}): Promise<MemoryAdoptionRecord[]> {
  const deltas = collectDraftEditDeltas(params.before, params.after);
  if (deltas.length === 0) {
    return [];
  }

  // 范例通道（先做：它不依赖后面的异步写入，且失败无副作用）
  const examples = toEditExamples({
    taskId: params.taskId,
    ...(params.matterId ? { matterId: params.matterId } : {}),
    ...(params.deliverableType ? { deliverableType: params.deliverableType } : {}),
    ...(params.reviewNote ? { reviewNote: params.reviewNote } : {}),
    deltas,
  });
  recordEditExamples(params.workspaceDir, examples);

  // 偏好通道（原有行为，未变）
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
