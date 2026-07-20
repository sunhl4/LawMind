/**
 * Standalone 交付预览 window (Electron aux BrowserWindow).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadInitialAppConfig, type AppConfig } from "./lawmind-app-bootstrap";
import { apiGetJson, errorMessage } from "./api-client";
import { LawmindDraftDocumentPreview } from "./LawmindDraftDocumentPreview";
import {
  draftDocumentEditorValueFromDraft,
  type DraftDocumentEditorValue,
} from "./lawmind-draft-document-editor";
import { reviewStatusDisplayLabel } from "./lawmind-review-display";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import {
  REVIEW_PREVIEW_SYNC_CHANNEL,
  shouldApplySavedPreviewOverLive,
  type ReviewPreviewSyncMessage,
} from "./lawmind-popout-route";

type Props = {
  taskId: string;
};

export function LawmindReviewPreviewPopout(props: Props): ReactNode {
  const { taskId } = props;
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [value, setValue] = useState<DraftDocumentEditorValue | null>(null);
  const [reviewStatusLabel, setReviewStatusLabel] = useState<string | undefined>();
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastLiveAtRef = useRef<number | null>(null);
  const hasValueRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await loadInitialAppConfig();
        if (cancelled) {
          return;
        }
        setConfig(cfg);
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e, "无法连接本地服务"));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config?.apiBase || !taskId) {
      return;
    }
    let cancelled = false;
    const loadSaved = async () => {
      // Never clobber a fresher live editor value (including race with initial GET).
      if (!shouldApplySavedPreviewOverLive({ lastLiveAt: lastLiveAtRef.current })) {
        if (!cancelled) {
          setLoading(false);
        }
        return;
      }
      try {
        const j = await apiGetJson<{ ok?: boolean; draft?: ArtifactDraft }>(
          config.apiBase,
          `/api/drafts/${encodeURIComponent(taskId)}`,
        );
        if (cancelled) {
          return;
        }
        if (!shouldApplySavedPreviewOverLive({ lastLiveAt: lastLiveAtRef.current })) {
          setLoading(false);
          return;
        }
        if (!j.ok || !j.draft) {
          if (!hasValueRef.current) {
            setError("未找到该草稿");
          }
          setLoading(false);
          return;
        }
        const next = draftDocumentEditorValueFromDraft(j.draft);
        hasValueRef.current = true;
        setValue(next);
        setReviewStatusLabel(reviewStatusDisplayLabel(j.draft.reviewStatus));
        setOutputPath(j.draft.outputPath ?? null);
        setError(null);
        document.title = `${(j.draft.title ?? "").trim() || "交付预览"} — LawMind`;
      } catch (e) {
        if (!cancelled && !hasValueRef.current) {
          setError(errorMessage(e, "加载预览失败"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void loadSaved();
    const poll = window.setInterval(() => void loadSaved(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [config?.apiBase, taskId]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }
    const ch = new BroadcastChannel(REVIEW_PREVIEW_SYNC_CHANNEL);
    const onMessage = (evt: MessageEvent<ReviewPreviewSyncMessage>) => {
      const msg = evt.data;
      if (!msg || msg.taskId !== taskId) {
        return;
      }
      if (msg.type !== "editor-value") {
        return;
      }
      lastLiveAtRef.current = msg.updatedAt ?? Date.now();
      hasValueRef.current = true;
      setValue(msg.value);
      if (msg.reviewStatusLabel) {
        setReviewStatusLabel(msg.reviewStatusLabel);
      }
      if (msg.outputPath !== undefined) {
        setOutputPath(msg.outputPath);
      }
      setError(null);
      setLoading(false);
      const title = (msg.value.title ?? "").trim() || "交付预览";
      document.title = `${title} — LawMind`;
    };
    ch.addEventListener("message", onMessage);
    const request: ReviewPreviewSyncMessage = { type: "sync-request", taskId };
    ch.postMessage(request);
    return () => {
      ch.removeEventListener("message", onMessage);
      ch.close();
    };
  }, [taskId]);

  if (loading && !value) {
    return (
      <div className="lm-review-preview-popout">
        <p className="lm-meta">加载交付预览…</p>
      </div>
    );
  }

  if (error && !value) {
    return (
      <div className="lm-review-preview-popout">
        <p className="lm-error">{error}</p>
      </div>
    );
  }

  if (!config?.apiBase || !value) {
    return null;
  }

  return (
    <div className="lm-review-preview-popout" data-testid="lm-review-preview-popout">
      <LawmindDraftDocumentPreview
        taskId={taskId}
        apiBase={config.apiBase}
        value={value}
        outputPath={outputPath}
        reviewStatusLabel={reviewStatusLabel}
        popoutMode
      />
    </div>
  );
}
