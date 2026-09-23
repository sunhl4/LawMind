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

function digestSourceLabel(source: CarryoverOrigin["digestSource"]): string {
  if (source === "llm") {
    return "模型摘要";
  }
  if (source === "none") {
    return "无可提取要点";
  }
  return "要点提取";
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
  const parts: string[] = [];
  if (typeof origin.droppedMessageCount === "number" && origin.droppedMessageCount > 0) {
    parts.push(`整理 ${origin.droppedMessageCount} 条`);
  }
  if (typeof origin.digestChars === "number" && origin.digestChars > 0) {
    parts.push(`摘要 ${origin.digestChars.toLocaleString("zh-CN")} 字`);
  }
  parts.push(digestSourceLabel(origin.digestSource));
  const at = formatAt(origin.at);

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
          本对话续接自「{origin.title?.trim() || "上一段对话"}」（{parts.join(" · ")}
          {at ? ` · ${at}` : ""}）
        </p>
        <p className="lm-msg-carryover-meta">
          源对话仍可回看；草稿、案件档案与待办都在原处，不受影响。
        </p>
        {origin.digestPreview?.trim() ? (
          <details className="lm-msg-carryover-details">
            <summary>查看带过来的整理稿</summary>
            <pre className="lm-msg-carryover-preview">{origin.digestPreview.trim()}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
