import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import {
  describeDraftScaffold,
  type DraftScaffoldView,
} from "../../../../src/lawmind/deliverables/scaffold-status.ts";

export function pickLatestScaffoldDraft(drafts: ArtifactDraft[]): ArtifactDraft | null {
  for (const draft of drafts) {
    const status = draft.reviewStatus ?? "pending";
    if (status !== "pending" && status !== "modified") {
      continue;
    }
    if (describeDraftScaffold(draft).dense) {
      return draft;
    }
  }
  return null;
}

export function scaffoldChatBannerText(title: string): string {
  const trimmed = title.trim() || "这份草稿";
  return `「${trimmed}」仍是骨架稿，请打开改稿补全后再外发。`;
}

export function scaffoldReviewBannerText(view: DraftScaffoldView): string {
  if (!view.dense) {
    return view.label;
  }
  return view.hint ?? "仍为骨架稿，须由模型或律师补全后再交付。";
}
