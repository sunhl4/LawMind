/**
 * 骨架稿状态：给审核栏、对话条和 Word 回写用同一套判断。
 */

import type { ArtifactDraft } from "../types.js";
import { countScaffoldPlaceholdersInDraft, isHighScaffoldDensity } from "./placeholder-pattern.js";

export type DraftScaffoldView = {
  dense: boolean;
  samples: string[];
  label: string;
  hint?: string;
};

export function draftPlainTextLength(draft: ArtifactDraft): number {
  return [
    draft.title,
    draft.summary,
    ...draft.sections.map((section) => `${section.heading}\n${section.body}`),
  ]
    .join("\n")
    .trim().length;
}

export function describeDraftScaffold(draft: ArtifactDraft): DraftScaffoldView {
  const samples = countScaffoldPlaceholdersInDraft(draft.sections);
  if (samples.length === 0) {
    return { dense: false, samples: [], label: "正文非骨架稿" };
  }
  const dense = isHighScaffoldDensity(samples, draftPlainTextLength(draft));
  return {
    dense,
    samples,
    label: dense ? "仍为骨架稿" : "文中仍有未填项",
    hint: dense
      ? `检出 ${samples.length} 处骨架占位（如 ${samples.slice(0, 3).join("、")}）。这是离线填空，不能当作成稿外发。`
      : undefined,
  };
}
