import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";

export type DraftStatusHint = {
  show: boolean;
  message: string;
  heuristic?: boolean;
};

const OVERCONFIDENT_PHRASES = [
  /已全部就绪/i,
  /EMS/i,
  /可直接对外/i,
  /验收已通过/i,
  /可以交付/i,
];

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

  const base = "本条对话关联的草稿尚未通过审核。请在「审核」中把关后再对外使用。";
  if (status === "modified") {
    return { show: true, message: "草稿已标为需修改，请先在审核台处理后再继续对外使用。" };
  }
  if (status === "rejected") {
    return { show: true, message: "草稿已被驳回，请修订后重新提交审核。" };
  }

  const text = input.assistantText?.trim() ?? "";
  const heuristic =
    status === "pending" && text.length > 0 && OVERCONFIDENT_PHRASES.some((re) => re.test(text));
  if (heuristic) {
    return {
      show: true,
      message: "助手表述可能过于乐观；关联草稿仍为待审核，请先在审核台确认。",
      heuristic: true,
    };
  }

  return { show: true, message: base };
}
