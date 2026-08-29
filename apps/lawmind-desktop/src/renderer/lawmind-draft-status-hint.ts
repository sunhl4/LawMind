import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";

export type DraftStatusHint = {
  show: boolean;
  message: string;
  heuristic?: boolean;
};

export function shouldShowDraftStatusHint(input: {
  role: "user" | "assistant" | "system";
  linkedTaskId?: string | null;
  reviewStatus?: ArtifactDraft["reviewStatus"] | null;
  assistantText?: string;
  /** When gateDecisions already surfaced blocking state, skip heuristic fallback. */
  gateBlockingCount?: number;
}): DraftStatusHint {
  if (input.role !== "assistant" || !input.linkedTaskId?.trim()) {
    return { show: false, message: "" };
  }
  if ((input.gateBlockingCount ?? 0) > 0) {
    return { show: false, message: "" };
  }
  const status = input.reviewStatus ?? "pending";
  if (status === "approved") {
    return { show: false, message: "" };
  }
  if (status === "modified") {
    return { show: true, message: "需修改" };
  }
  if (status === "rejected") {
    return { show: true, message: "已驳回" };
  }
  return { show: true, message: "已出结果，可改稿" };
}
