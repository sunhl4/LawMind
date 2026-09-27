import type { ReactNode } from "react";

/**
 * 「续接来源」卡片：本对话是从哪条对话续接来的，带过来了什么。
 *
 * 法律场景要能**核对**「到底带过来了什么」，所以这里不是一句「已带上文」了事：
 * 给出源对话标题与 id、压了多少条、摘要多少字、用了哪种摘要，并可展开摘要预览；
 * 完整整理稿作为合成消息在模型上下文里（律师气泡看不到，避免把蒸馏当成律师发言）。
 */

export type CarryoverOrigin = {
  sessionId: string;
  at?: string;
  title?: string;
  digestSource?: "llm" | "extractive" | "none";
  digestChars?: number;
  droppedMessageCount?: number;
  digestPreview?: string;
};

function carryoverSummary(origin: CarryoverOrigin): string | undefined {
  const dropped = origin.droppedMessageCount;
  if (origin.digestSource === "none") {
    return typeof dropped === "number" && dropped > 0
      ? `较早的 ${dropped} 条没有可带走的要点`
      : "没有可带走的要点";
  }
  if (typeof dropped === "number" && dropped > 0) {
    return `较早的 ${dropped} 条已收成要点`;
  }
  return undefined;
}

function formatAt(iso: string | undefined): string | undefined {
  if (!iso) {
    return undefined;
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return undefined;
  }
  try {
    return new Date(ms).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return undefined;
  }
}

export function LawmindMsgCarryoverNotice({
  origin,
}: {
  origin: CarryoverOrigin;
}): ReactNode {
  const summary = carryoverSummary(origin);
  const at = formatAt(origin.at);
  const detail = [summary, at].filter(Boolean).join(" · ");

  return (
    <div
      className="lm-msg-compact-notice lm-msg-carryover-notice"
      role="status"
      data-testid="lm-msg-carryover-notice"
    >
      <span className="lm-msg-compact-notice-icon" aria-hidden>
        ↩
      </span>
      <div className="lm-msg-carryover-body">
        <p className="lm-msg-carryover-head">
          本对话接着「{origin.title?.trim() || "上一段对话"}」办
          {detail ? `（${detail}）` : ""}
        </p>
        <p className="lm-msg-carryover-meta">
          上一段对话仍可回看。稿子和案件材料都留在本案。
        </p>
        {origin.digestPreview?.trim() ? (
          <details className="lm-msg-carryover-details">
            <summary>查看带过来的要点</summary>
            <pre className="lm-msg-carryover-preview">{origin.digestPreview.trim()}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
