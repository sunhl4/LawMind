/**
 * 审核台文档预览 — 只读排版视图（与编辑区左右对照）。
 * 支持 Electron 拖出/按钮打开独立窗口。
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { LawmindSourcePillList } from "./LawmindSourcePreview";
import type { DraftDocumentEditorValue } from "./lawmind-draft-document-editor";
import { resolveSourceAnchorId } from "./lawmind-source-anchor";
import {
  REVIEW_PREVIEW_SYNC_CHANNEL,
  type ReviewPreviewSyncMessage,
} from "./lawmind-popout-route";

type Props = {
  taskId: string;
  apiBase: string;
  value: DraftDocumentEditorValue;
  outputPath?: string | null;
  reviewStatusLabel?: string;
  /** Standalone aux window — hide undock controls */
  popoutMode?: boolean;
};

async function openReviewPreviewWindow(opts: {
  taskId: string;
  title?: string;
}): Promise<void> {
  const desk = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
  if (desk?.openAuxWindow) {
    await desk.openAuxWindow({
      kind: "review-preview",
      taskId: opts.taskId,
      title: opts.title?.trim() || "交付预览",
    });
    return;
  }
  const params = new URLSearchParams();
  params.set("lm-popout", "review-preview");
  params.set("taskId", opts.taskId);
  window.open(`${window.location.origin}${window.location.pathname}#${params.toString()}`, "_blank");
}

export function LawmindDraftDocumentPreview(props: Props): ReactNode {
  const { taskId, apiBase, value, outputPath, reviewStatusLabel, popoutMode = false } = props;
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const undockingRef = useRef(false);

  const publishLiveValue = useCallback(() => {
    if (popoutMode || typeof BroadcastChannel === "undefined") {
      return;
    }
    const ch = new BroadcastChannel(REVIEW_PREVIEW_SYNC_CHANNEL);
    const msg: ReviewPreviewSyncMessage = {
      type: "editor-value",
      taskId,
      value,
      reviewStatusLabel,
      outputPath: outputPath ?? null,
      source: "live",
      updatedAt: Date.now(),
    };
    ch.postMessage(msg);
    ch.close();
  }, [popoutMode, taskId, value, reviewStatusLabel, outputPath]);

  useEffect(() => {
    publishLiveValue();
  }, [publishLiveValue]);

  useEffect(() => {
    if (popoutMode || typeof BroadcastChannel === "undefined") {
      return;
    }
    const ch = new BroadcastChannel(REVIEW_PREVIEW_SYNC_CHANNEL);
    const onMessage = (evt: MessageEvent<ReviewPreviewSyncMessage>) => {
      const msg = evt.data;
      if (!msg || msg.type !== "sync-request" || msg.taskId !== taskId) {
        return;
      }
      publishLiveValue();
    };
    ch.addEventListener("message", onMessage);
    return () => {
      ch.removeEventListener("message", onMessage);
      ch.close();
    };
  }, [popoutMode, taskId, publishLiveValue]);

  const handleUndock = useCallback(async () => {
    if (undockingRef.current || popoutMode) {
      return;
    }
    undockingRef.current = true;
    try {
      await openReviewPreviewWindow({
        taskId,
        title: (value.title ?? "").trim() || "交付预览",
      });
      // New window or focused existing — push current (possibly dirty) editor value.
      publishLiveValue();
    } finally {
      window.setTimeout(() => {
        undockingRef.current = false;
      }, 600);
    }
  }, [popoutMode, taskId, value.title, publishLiveValue]);

  const onGripPointerDown = (e: ReactPointerEvent) => {
    if (popoutMode || e.button !== 0) {
      return;
    }
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onGripPointerMove = (e: ReactPointerEvent) => {
    const start = dragStartRef.current;
    if (!start) {
      return;
    }
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (dist > 64) {
      dragStartRef.current = null;
      void handleUndock();
    }
  };

  const onGripPointerUp = (e: ReactPointerEvent) => {
    dragStartRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="lm-draft-doc-preview" aria-label="文档预览">
      <header className="lm-draft-doc-preview-header">
        <div className="lm-draft-doc-preview-header-main">
          {!popoutMode ? (
            <button
              type="button"
              className="lm-draft-doc-preview-undock-grip"
              title="拖出到新窗口，或点击右侧按钮打开"
              aria-label="拖出交付预览到新窗口"
              onPointerDown={onGripPointerDown}
              onPointerMove={onGripPointerMove}
              onPointerUp={onGripPointerUp}
              onPointerCancel={onGripPointerUp}
            >
              ⋮⋮
            </button>
          ) : null}
          <span className="lm-draft-doc-preview-kicker">交付预览</span>
          {reviewStatusLabel ? (
            <span className="lm-draft-doc-preview-status">{reviewStatusLabel}</span>
          ) : null}
        </div>
        {!popoutMode ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            title="在独立窗口中打开交付预览"
            onClick={() => void handleUndock()}
          >
            新窗口打开
          </button>
        ) : null}
      </header>
      <article className="lm-draft-doc-preview-body">
        <h1 className="lm-draft-doc-preview-title">{(value.title ?? "").trim() || "（无标题）"}</h1>
        {(value.summary ?? "").trim() ? (
          <div className="lm-draft-doc-preview-summary">
            <p className="lm-draft-doc-preview-summary-label">执行摘要</p>
            <p className="lm-draft-doc-preview-summary-text">{value.summary}</p>
          </div>
        ) : null}
        {value.sections.map((section, index) => {
          const citations = (section.citations ?? []).filter(Boolean);
          const key = `${index}-${section.heading.slice(0, 24)}`;
          return (
            <section
              key={key}
              id={resolveSourceAnchorId(taskId, section.heading)}
              className="lm-draft-doc-preview-section"
            >
              <h2 className="lm-draft-doc-preview-heading">{section.heading}</h2>
              <div className="lm-draft-doc-preview-text">{section.body || "（本节暂无正文）"}</div>
              {citations.length > 0 ? (
                <div className="lm-draft-section-cites">
                  <span className="lm-meta">引用：</span>
                  <LawmindSourcePillList apiBase={apiBase} taskId={taskId} sourceIds={citations} />
                </div>
              ) : null}
            </section>
          );
        })}
        {outputPath ? (
          <p className="lm-meta lm-draft-doc-preview-output">已有交付文件：{outputPath}</p>
        ) : null}
      </article>
    </section>
  );
}
