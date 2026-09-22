/**
 * 审查口径：立场 / 重点 / 深度。升专案组时随稿带走，不靠律师再填一遍。
 */

export type ReviewBrief = {
  stance?: string;
  focus?: string;
  depth?: string;
};

const FOCUS_LINE = /(?:^|\n)[-\s]*审查重点[:：]\s*(.+)/;
const STANCE_LINE = /(?:^|\n)[-\s]*己方立场[:：]\s*(.+)/;
const DEPTH_LINE = /(?:^|\n)[-\s]*审查深度[:：]\s*(.+)/;
const PACKED = /【审查口径】立场[:：]([^；\n]+)(?:；重点[:：]([^；\n]+))?(?:；深度[:：]([^\n]+))?/;

function firstCapture(match: RegExpMatchArray | null): string | undefined {
  const value = match?.[1]?.trim();
  return value || undefined;
}

function normalizeDepth(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const short = raw.match(/^(快速|标准|深度)/);
  if (short?.[1]) {
    return short[1];
  }
  return raw.split(/[。.]/)[0]?.trim() || raw;
}

export function extractReviewBrief(text: string): ReviewBrief {
  const packed = text.match(PACKED);
  const focus = firstCapture(text.match(FOCUS_LINE)) ?? packed?.[2]?.trim();
  const stance = firstCapture(text.match(STANCE_LINE)) ?? packed?.[1]?.trim();
  const depth = normalizeDepth(firstCapture(text.match(DEPTH_LINE)) ?? packed?.[3]?.trim());
  return {
    ...(stance ? { stance } : {}),
    ...(focus ? { focus } : {}),
    ...(depth ? { depth } : {}),
  };
}

export function mergeReviewBriefs(...briefs: Array<ReviewBrief | undefined>): ReviewBrief {
  const out: ReviewBrief = {};
  for (const brief of briefs) {
    if (!brief) {
      continue;
    }
    if (brief.stance && !out.stance) {
      out.stance = brief.stance;
    }
    if (brief.focus && !out.focus) {
      out.focus = brief.focus;
    }
    if (brief.depth && !out.depth) {
      out.depth = brief.depth;
    }
  }
  return out;
}

export function hasReviewBrief(brief: ReviewBrief): boolean {
  return Boolean(brief.stance || brief.focus || brief.depth);
}

export function formatReviewBriefHeader(brief: ReviewBrief): string {
  if (!hasReviewBrief(brief)) {
    return "";
  }
  const parts = [
    brief.stance ? `立场：${brief.stance}` : null,
    brief.focus ? `重点：${brief.focus}` : null,
    brief.depth ? `深度：${brief.depth}` : null,
  ].filter(Boolean);
  return `【审查口径】${parts.join("；")}`;
}

export function mergeSourceTextWithBrief(sourceText: string, brief: ReviewBrief): string {
  const header = formatReviewBriefHeader(brief);
  if (!header) {
    return sourceText;
  }
  if (sourceText.includes("【审查口径】")) {
    return sourceText;
  }
  const body = sourceText.trim();
  return body ? `${header}\n\n${body}` : header;
}

export function appendCampaignUpgradeInstruction(prompt: string, brief?: ReviewBrief): string {
  const header = brief ? formatReviewBriefHeader(brief) : "";
  const upgrade = "【律师指示】请按完整合同审查专案组（标准五角色）执行，勿走轻量路径。";
  return [prompt.trim(), header, upgrade].filter(Boolean).join("\n\n");
}
