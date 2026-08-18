/**
 * 稿件 critic：第二意见。只追加复核备注，不改写模型正文。
 */

import type { ArtifactDraft } from "../types.js";
import {
  buildClauseGraphFromDraft,
  clauseGraphRiskNotes,
  type ClauseGraph,
} from "./clause-graph.js";

const CRITIC_PREFIX = "复核：";

export function hasCriticNotes(draft: ArtifactDraft): boolean {
  return draft.reviewNotes.some((note) => note.startsWith(CRITIC_PREFIX));
}

export function critiqueDraft(draft: ArtifactDraft, graph?: ClauseGraph): string[] {
  const clauseGraph = graph ?? buildClauseGraphFromDraft(draft);
  const notes: string[] = [];
  for (const line of clauseGraphRiskNotes(clauseGraph)) {
    notes.push(`${CRITIC_PREFIX}${line}`);
  }
  const haystack = draft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n");
  if (
    (draft.deliverableType === "contract.rental" ||
      draft.deliverableType === "contract.general" ||
      /(合同|协议)/.test(`${draft.title}${haystack}`)) &&
    !/争议解决|管辖|仲裁/.test(haystack)
  ) {
    notes.push(`${CRITIC_PREFIX}全文未见争议解决或管辖约定，外发前请补上。`);
  }
  if (draft.deliverableType === "letter.demand" && !/期限|日内|之前|截止/.test(haystack)) {
    notes.push(`${CRITIC_PREFIX}律师函未见履行期限，对方难以按期响应。`);
  }
  if (draft.sections.length === 0) {
    notes.push(`${CRITIC_PREFIX}草稿没有正文，不能当作成稿。`);
  }
  return unique(notes).slice(0, 16);
}

export function applyDraftCritic(draft: ArtifactDraft): ArtifactDraft {
  if (hasCriticNotes(draft)) {
    return draft;
  }
  const graph = buildClauseGraphFromDraft(draft);
  const notes = critiqueDraft(draft, graph);
  if (notes.length === 0) {
    return draft;
  }
  return {
    ...draft,
    reviewNotes: [...draft.reviewNotes, ...notes],
  };
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
